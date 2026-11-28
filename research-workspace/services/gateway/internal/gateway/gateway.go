// Package gateway is the authenticating reverse proxy in front of the AI service.
//
// It verifies the caller's JWT, then forwards the request with two headers the
// client cannot forge: X-Internal-Token (shared secret) and X-User-Id. The JWT
// itself is never forwarded. Only an allowlist of API prefixes is routable.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"keycodes.dev/gateway/internal/jwtauth"
)

type Config struct {
	JWTSecret     []byte
	Issuer        string // optional; if set the JWT iss claim must match
	AIURL         *url.URL
	InternalToken string
	CORSOrigins   []string
	RPS           float64
	Burst         int
	MaxBodyBytes  int64
	Logger        *slog.Logger
	Now           func() time.Time // injectable for tests
	// Email/password login (POST /auth/login). Both unset means login is not
	// configured and the endpoint answers 503. The password is stored only as
	// a bcrypt hash, never in plaintext.
	AdminEmail        string
	AdminPasswordHash string
}

// The single shared admin identity: the same UUID mint_token.py uses, so a
// password login and a minted token are the same user to the AI service.
const adminSubject = "11111111-1111-4111-8111-111111111111"

// loginTTL matches the token lifetime mint_token.py uses by default (30 days).
const loginTTL = 30 * 24 * time.Hour

// Only these prefixes are forwarded. The AI service's /health, /docs and
// /openapi.json are intentionally not reachable through the gateway.
var allowedPrefixes = []string{"/projects", "/tasks", "/threads", "/discover", "/signals", "/concepts", "/comments", "/people", "/attachments"}

type ctxKey struct{}

func New(cfg Config) (http.Handler, error) {
	switch {
	case len(cfg.JWTSecret) < 32:
		return nil, errors.New("JWT secret must be at least 32 bytes")
	case len(cfg.InternalToken) < 16:
		return nil, errors.New("internal token must be at least 16 characters")
	case cfg.AIURL == nil:
		return nil, errors.New("AI service URL is required")
	case cfg.RPS <= 0 || cfg.Burst < 1:
		return nil, errors.New("rate limit must be positive")
	case cfg.MaxBodyBytes <= 0:
		return nil, errors.New("max body size must be positive")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}

	g := &server{cfg: cfg, lim: newLimiter(cfg.RPS, cfg.Burst, cfg.Now),
		// Login attempts are limited per client IP, not per user: at login time
		// there is no authenticated subject yet. 10 attempts, refilling at
		// 10 per minute, so a brute-force run stalls after the first burst.
		loginLim: newLimiter(10.0/60.0, 10, cfg.Now)}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 5 * time.Minute // an /ask call runs several LLM requests

	g.proxy = &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(cfg.AIURL)
			pr.SetXForwarded()
			h := pr.Out.Header
			// Never pass the credential on, and never trust identity headers from the client.
			h.Del("Authorization")
			h.Del("Cookie")
			h.Del("X-Internal-Token")
			h.Del("X-User-Id")
			h.Set("X-Internal-Token", cfg.InternalToken)
			h.Set("X-User-Id", pr.In.Context().Value(ctxKey{}).(string))
		},
		Transport:     transport,
		FlushInterval: -1, // never buffer: server-sent events must reach the browser as they happen
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) || strings.Contains(err.Error(), "request body too large") {
				writeJSON(w, http.StatusRequestEntityTooLarge, "request body too large")
				return
			}
			cfg.Logger.Error("upstream error", "err", err.Error())
			writeJSON(w, http.StatusBadGateway, "upstream unavailable")
		},
	}
	return g.recoverer(g.logger(g.cors(http.HandlerFunc(g.route)))), nil
}

type server struct {
	cfg      Config
	lim      *limiter
	loginLim *limiter
	proxy    *httputil.ReverseProxy
}

func writeJSON(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func routable(p string) bool {
	for _, pre := range allowedPrefixes {
		if p == pre || strings.HasPrefix(p, pre+"/") {
			return true
		}
	}
	return false
}

func (g *server) route(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}` + "\n"))
		return
	}
	// Reject anything that is not already a clean path (../, //, ./) so a crafted
	// path cannot slip past the allowlist and be normalised upstream.
	if clean := path.Clean(r.URL.Path); clean != strings.TrimRight(r.URL.Path, "/") && r.URL.Path != "/" {
		writeJSON(w, http.StatusBadRequest, "bad path")
		return
	}
	// Public login endpoint: it must come before the allowlist + Bearer check,
	// because /auth is not a routable prefix and there is no token yet.
	if r.URL.Path == "/auth/login" {
		g.login(w, r)
		return
	}
	if !routable(r.URL.Path) {
		writeJSON(w, http.StatusNotFound, "not found")
		return
	}

	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		g.unauthorized(w)
		return
	}
	claims, err := jwtauth.Verify(token, g.cfg.JWTSecret, g.cfg.Now(), g.cfg.Issuer)
	if err != nil {
		g.unauthorized(w)
		return
	}

	if allowed, wait := g.lim.allow(claims.Subject); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeJSON(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	if r.ContentLength > g.cfg.MaxBodyBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, g.cfg.MaxBodyBytes) // also covers chunked bodies

	if strings.HasSuffix(r.URL.Path, "/events") {
		// A live event stream is meant to stay open; the server-wide write deadline would cut it off.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	}

	ctx := context.WithValue(r.Context(), ctxKey{}, claims.Subject)
	g.proxy.ServeHTTP(w, r.WithContext(ctx))
}

func (g *server) unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	writeJSON(w, http.StatusUnauthorized, "unauthorized")
}

// ---- email/password login (POST /auth/login) ------------------------------

// login checks one shared admin login (ADMIN_EMAIL + bcrypt ADMIN_PASSWORD_HASH)
// and returns the same JWT a minted token would carry, so the rest of the
// system cannot tell a password login from a token login. Failures never say
// whether the email or the password was wrong.
func (g *server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if allowed, wait := g.loginLim.allow(clientIP(r)); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeJSON(w, http.StatusTooManyRequests, "too many login attempts, try again later")
		return
	}
	if g.cfg.AdminEmail == "" || g.cfg.AdminPasswordHash == "" {
		writeJSON(w, http.StatusServiceUnavailable, "login not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var creds struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		writeJSON(w, http.StatusBadRequest, "invalid request")
		return
	}
	// Compare the password hash even when the email is wrong, so a wrong email
	// costs the same time as a wrong password.
	emailOK := creds.Email == g.cfg.AdminEmail
	pwErr := bcrypt.CompareHashAndPassword([]byte(g.cfg.AdminPasswordHash), []byte(creds.Password))
	if !emailOK || pwErr != nil {
		writeJSON(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	token := jwtauth.Sign(adminSubject, g.cfg.JWTSecret, g.cfg.Now(), loginTTL, g.cfg.Issuer)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// clientIP is the address the login rate limiter keys on. The gateway sits
// behind Caddy, which appends the real client IP to X-Forwarded-For, so the
// LAST entry is the client; a client-supplied first entry is ignored. Without
// the header, the peer address is used.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// ---- middleware -------------------------------------------------------------

func (g *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && g.originAllowed(origin) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
			// lets the browser read the report filename and fingerprint on downloads
			h.Set("Access-Control-Expose-Headers", "Content-Disposition, X-Report-Fingerprint")
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				w.WriteHeader(http.StatusNoContent) // preflight carries no credentials
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (g *server) originAllowed(origin string) bool {
	for _, o := range g.cfg.CORSOrigins {
		if o == origin {
			return true
		}
	}
	return false
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// logger records method, path and outcome. It never logs query strings, headers
// or bodies: those can hold tokens and confidential research content.
func (g *server) logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		g.cfg.Logger.Info("request", "method", r.Method, "path", r.URL.Path,
			"status", sw.status, "ms", time.Since(start).Milliseconds())
	})
}

func (g *server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				g.cfg.Logger.Error("panic", "err", fmt.Sprint(rec), "stack", string(debug.Stack()))
				writeJSON(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
