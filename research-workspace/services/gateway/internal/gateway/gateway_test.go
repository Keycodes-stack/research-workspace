package gateway

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"keycodes.dev/gateway/internal/jwtauth"
)

var (
	secret   = []byte("0123456789abcdef0123456789abcdef")
	internal = "internal-shared-secret"
	userA    = "11111111-1111-4111-8111-111111111111"
	userB    = "22222222-2222-4222-8222-222222222222"
	t0       = time.Unix(1_800_000_000, 0)
)

type upstream struct {
	mu    sync.Mutex
	calls int
	last  *http.Request
	body  string
}

func (u *upstream) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.calls++
		u.last, u.body = r.Clone(r.Context()), string(b)
		u.mu.Unlock()
		w.Header().Set("X-Upstream", "yes")
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"ok":true}`)
	})
}

func (u *upstream) count() int { u.mu.Lock(); defer u.mu.Unlock(); return u.calls }

// snap returns the last upstream request and body, safely (the handler runs on
// the httptest server's goroutine).
func (u *upstream) snap() (*http.Request, string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.last, u.body
}

type env struct {
	h  http.Handler
	up *upstream
}

func setup(t *testing.T, mut func(*Config)) env {
	t.Helper()
	up := &upstream{}
	srv := httptest.NewServer(up.handler())
	t.Cleanup(srv.Close)
	target, _ := url.Parse(srv.URL)

	cfg := Config{
		JWTSecret: secret, AIURL: target, InternalToken: internal,
		CORSOrigins: []string{"https://app.example.com"},
		RPS:         100, Burst: 100, MaxBodyBytes: 1024,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:    func() time.Time { return t0 },
	}
	if mut != nil {
		mut(&cfg)
	}
	h, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return env{h, up}
}

func token(sub string) string { return jwtauth.Sign(sub, secret, t0, time.Hour, "") }

func do(h http.Handler, method, path string, hdr map[string]string, body io.Reader) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, body)
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func bearer(sub string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token(sub)}
}

func TestProxiesAuthenticatedRequestWithTrustedHeaders(t *testing.T) {
	e := setup(t, nil)
	hdr := bearer(userA)
	hdr["Cookie"] = "session=abc"
	w := do(e.h, "POST", "/projects/p1/tasks?x=1", hdr, strings.NewReader(`{"title":"t"}`))

	if w.Code != http.StatusCreated || w.Header().Get("X-Upstream") != "yes" || !strings.Contains(w.Body.String(), "ok") {
		t.Fatalf("response not passed through: %d %q", w.Code, w.Body.String())
	}
	got, body := e.up.snap()
	if got.URL.Path != "/projects/p1/tasks" || got.URL.RawQuery != "x=1" || body != `{"title":"t"}` {
		t.Fatalf("request not forwarded intact: %s?%s %q", got.URL.Path, got.URL.RawQuery, body)
	}
	if got.Header.Get("X-User-Id") != userA || got.Header.Get("X-Internal-Token") != internal {
		t.Fatalf("identity headers wrong: %v", got.Header)
	}
	if got.Header.Get("Authorization") != "" || got.Header.Get("Cookie") != "" {
		t.Fatalf("credentials leaked upstream: %v", got.Header)
	}
}

func TestClientCannotSpoofIdentityHeaders(t *testing.T) {
	e := setup(t, nil)
	hdr := bearer(userA)
	hdr["X-User-Id"] = userB
	hdr["X-Internal-Token"] = "guess"
	do(e.h, "GET", "/projects", hdr, nil)
	last, _ := e.up.snap()
	if last.Header.Get("X-User-Id") != userA || last.Header.Get("X-Internal-Token") != internal {
		t.Fatalf("spoofed headers reached upstream: %v", last.Header)
	}
}

func TestRejectsMissingOrInvalidCredentials(t *testing.T) {
	e := setup(t, nil)
	other := jwtauth.Sign(userA, []byte("another-secret-another-secret-0000"), t0, time.Hour, "")
	expired := jwtauth.Sign(userA, secret, t0.Add(-2*time.Hour), time.Hour, "")
	cases := map[string]map[string]string{
		"no header":      nil,
		"basic auth":     {"Authorization": "Basic Zm9vOmJhcg=="},
		"empty bearer":   {"Authorization": "Bearer "},
		"wrong secret":   {"Authorization": "Bearer " + other},
		"expired":        {"Authorization": "Bearer " + expired},
		"lowercase word": {"Authorization": "bearer " + token(userA)},
		"garbage":        {"Authorization": "Bearer not.a.jwt"},
	}
	for name, hdr := range cases {
		w := do(e.h, "GET", "/projects", hdr, nil)
		if w.Code != http.StatusUnauthorized || w.Header().Get("WWW-Authenticate") != "Bearer" {
			t.Errorf("%s: got %d", name, w.Code)
		}
	}
	if e.up.count() != 0 {
		t.Fatal("unauthenticated requests reached the AI service")
	}
}

func TestOnlyAllowlistedPathsAreRoutable(t *testing.T) {
	e := setup(t, nil)
	for _, p := range []string{"/health", "/docs", "/openapi.json", "/admin", "/", "/projectsX", "/discover-and-ingest"} {
		if w := do(e.h, "GET", p, bearer(userA), nil); w.Code != http.StatusNotFound {
			t.Errorf("%s: got %d, want 404", p, w.Code)
		}
	}
	for _, p := range []string{"/projects", "/projects/abc/search", "/tasks/abc/approve", "/threads/abc/ask", "/discover"} {
		if w := do(e.h, "GET", p, bearer(userA), nil); w.Code != http.StatusCreated {
			t.Errorf("%s: got %d, want proxied", p, w.Code)
		}
	}
}

func TestPathTricksCannotEscapeTheAllowlist(t *testing.T) {
	e := setup(t, nil)
	before := e.up.count()
	for _, p := range []string{"/projects/../health", "/projects/%2e%2e/health", "/projects//x", "/projects/./x", "/threads/../../docs"} {
		w := do(e.h, "GET", p, bearer(userA), nil)
		if w.Code != http.StatusBadRequest && w.Code != http.StatusNotFound {
			t.Errorf("%s: got %d", p, w.Code)
		}
	}
	if e.up.count() != before {
		t.Fatal("a crafted path reached the AI service")
	}
}

func TestHealthzIsOpenAndDoesNotTouchUpstream(t *testing.T) {
	e := setup(t, nil)
	if w := do(e.h, "GET", "/healthz", nil, nil); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"ok"`) {
		t.Fatalf("got %d", w.Code)
	}
	if e.up.count() != 0 {
		t.Fatal("healthz should not call upstream")
	}
}

func TestRateLimitIsPerUser(t *testing.T) {
	now := t0
	e := setup(t, func(c *Config) {
		c.RPS, c.Burst = 1, 3
		c.Now = func() time.Time { return now }
	})
	for i := 0; i < 3; i++ {
		if w := do(e.h, "GET", "/projects", bearer(userA), nil); w.Code != http.StatusCreated {
			t.Fatalf("request %d: %d", i, w.Code)
		}
	}
	w := do(e.h, "GET", "/projects", bearer(userA), nil)
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Fatalf("expected 429 with Retry-After, got %d", w.Code)
	}
	if w := do(e.h, "GET", "/projects", bearer(userB), nil); w.Code != http.StatusCreated {
		t.Fatalf("another user must be unaffected: %d", w.Code)
	}
	now = now.Add(2 * time.Second) // tokens refill
	if w := do(e.h, "GET", "/projects", bearer(userA), nil); w.Code != http.StatusCreated {
		t.Fatalf("limit should recover: %d", w.Code)
	}
}

func TestBodyLimit(t *testing.T) {
	e := setup(t, nil) // limit 1024 bytes
	big := strings.Repeat("x", 4096)

	if w := do(e.h, "POST", "/projects", bearer(userA), strings.NewReader(big)); w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("declared length: got %d", w.Code)
	}

	// unknown length (chunked): must be cut off mid-stream, not buffered or forwarded whole
	w := do(e.h, "POST", "/projects", bearer(userA), io.NopCloser(strings.NewReader(big)))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("chunked body: got %d", w.Code)
	}
	if _, body := e.up.snap(); len(body) >= len(big) {
		t.Fatal("whole oversized body reached upstream")
	}

	if w := do(e.h, "POST", "/projects", bearer(userA), strings.NewReader("small")); w.Code != http.StatusCreated {
		t.Fatalf("small body: got %d", w.Code)
	}
}

func TestCORS(t *testing.T) {
	e := setup(t, nil)
	pre := map[string]string{
		"Origin": "https://app.example.com", "Access-Control-Request-Method": "POST",
	}
	w := do(e.h, "OPTIONS", "/projects", pre, nil)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Fatalf("preflight from allowed origin: %d %v", w.Code, w.Header())
	}
	if e.up.count() != 0 {
		t.Fatal("preflight must not reach upstream")
	}

	bad := map[string]string{"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
	w = do(e.h, "OPTIONS", "/projects", bad, nil)
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("disallowed origin got CORS headers: %v", w.Header())
	}
	if w.Code != http.StatusUnauthorized { // falls through to normal auth, which fails
		t.Fatalf("got %d", w.Code)
	}

	hdr := bearer(userA)
	hdr["Origin"] = "https://app.example.com"
	w = do(e.h, "GET", "/projects", hdr, nil)
	if w.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" || w.Header().Get("Vary") == "" {
		t.Fatalf("actual request missing CORS headers: %v", w.Header())
	}
	if !strings.Contains(w.Header().Get("Access-Control-Expose-Headers"), "Content-Disposition") {
		t.Fatal("download headers must be exposed to the browser")
	}
	if strings.Contains(w.Header().Get("Access-Control-Allow-Origin"), "*") {
		t.Fatal("wildcard origin must never be sent")
	}
}

func TestUpstreamDownBecomes502(t *testing.T) {
	e := setup(t, func(c *Config) {
		dead, _ := url.Parse("http://127.0.0.1:1") // nothing listens here
		c.AIURL = dead
	})
	w := do(e.h, "GET", "/projects", bearer(userA), nil)
	if w.Code != http.StatusBadGateway || strings.Contains(w.Body.String(), "127.0.0.1") {
		t.Fatalf("got %d %q (must not leak upstream address)", w.Code, w.Body.String())
	}
}

func TestConfigValidation(t *testing.T) {
	target, _ := url.Parse("http://localhost:8000")
	good := Config{JWTSecret: secret, InternalToken: internal, AIURL: target, RPS: 1, Burst: 1, MaxBodyBytes: 1}
	if _, err := New(good); err != nil {
		t.Fatal(err)
	}
	bad := map[string]func(*Config){
		"short jwt secret":     func(c *Config) { c.JWTSecret = []byte("short") },
		"short internal token": func(c *Config) { c.InternalToken = "short" },
		"no ai url":            func(c *Config) { c.AIURL = nil },
		"zero rate":            func(c *Config) { c.RPS = 0 },
		"zero body":            func(c *Config) { c.MaxBodyBytes = 0 },
	}
	for name, mut := range bad {
		c := good
		mut(&c)
		if _, err := New(c); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

// A server-sent event must reach the client while the upstream response is still open.
func TestEventStreamIsNotBuffered(t *testing.T) {
	release := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-release
		io.WriteString(w, "data: second\n\n")
	}))
	defer up.Close()
	target, _ := url.Parse(up.URL)
	h, err := New(Config{
		JWTSecret: secret, AIURL: target, InternalToken: internal, RPS: 100, Burst: 100, MaxBodyBytes: 1024,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time { return t0 },
	})
	if err != nil {
		t.Fatal(err)
	}
	gw := httptest.NewServer(h)
	defer gw.Close()

	req, _ := http.NewRequest("GET", gw.URL+"/concepts/abc/events", nil)
	req.Header.Set("Authorization", "Bearer "+token(userA))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	got := make(chan string, 1)
	go func() {
		buf := make([]byte, 64)
		n, _ := resp.Body.Read(buf)
		got <- string(buf[:n])
	}()
	select {
	case s := <-got:
		if !strings.Contains(s, "first") {
			t.Fatalf("got %q", s)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("first event was buffered until the upstream finished")
	}
	close(release)
}
