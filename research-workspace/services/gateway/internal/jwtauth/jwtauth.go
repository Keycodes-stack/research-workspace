// Package jwtauth verifies and mints HS256 JWTs using only the standard library.
//
// Verification is deliberately strict: the algorithm is pinned to HS256 (so
// "alg":"none" and algorithm-confusion tokens are rejected), the signature is
// checked in constant time before any claim is trusted, and exp is mandatory.
package jwtauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	ErrMalformed = errors.New("malformed token")
	ErrAlg       = errors.New("unsupported algorithm")
	ErrSignature = errors.New("bad signature")
	ErrExpired   = errors.New("token expired")
	ErrNotYet    = errors.New("token not yet valid")
	ErrClaims    = errors.New("invalid claims")
)

const (
	maxTokenLen = 8 << 10
	leeway      = 30 * time.Second
)

var (
	b64      = base64.RawURLEncoding
	uuidExpr = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// Claims are the verified claims the gateway relies on.
type Claims struct {
	Subject string // lower-cased UUID of the user
	Expires time.Time
}

type payload struct {
	Sub string   `json:"sub"`
	Exp *float64 `json:"exp"`
	Nbf *float64 `json:"nbf"`
	Iss string   `json:"iss,omitempty"`
}

func sign(secret []byte, signingInput string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	return mac.Sum(nil)
}

// Verify checks token against secret at time now. If issuer is non-empty the
// iss claim must match it. The subject must be a UUID.
func Verify(token string, secret []byte, now time.Time, issuer string) (Claims, error) {
	if len(token) == 0 || len(token) > maxTokenLen {
		return Claims{}, ErrMalformed
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrMalformed
	}

	hb, err := b64.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if json.Unmarshal(hb, &header) != nil {
		return Claims{}, ErrMalformed
	}
	if header.Alg != "HS256" {
		return Claims{}, ErrAlg
	}

	sig, err := b64.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	if !hmac.Equal(sig, sign(secret, parts[0]+"."+parts[1])) {
		return Claims{}, ErrSignature
	}

	// Only now is the payload trusted enough to parse.
	pb, err := b64.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var p payload
	if json.Unmarshal(pb, &p) != nil {
		return Claims{}, ErrMalformed
	}
	if p.Exp == nil {
		return Claims{}, ErrClaims
	}
	exp := time.Unix(int64(*p.Exp), 0)
	if !now.Before(exp.Add(leeway)) {
		return Claims{}, ErrExpired
	}
	if p.Nbf != nil && now.Add(leeway).Before(time.Unix(int64(*p.Nbf), 0)) {
		return Claims{}, ErrNotYet
	}
	if issuer != "" && p.Iss != issuer {
		return Claims{}, ErrClaims
	}
	if !uuidExpr.MatchString(p.Sub) {
		return Claims{}, ErrClaims
	}
	return Claims{Subject: strings.ToLower(p.Sub), Expires: exp}, nil
}

// Sign mints a token. Used by cmd/mint-token for local development and by tests;
// in production tokens come from your identity provider.
func Sign(sub string, secret []byte, now time.Time, ttl time.Duration, issuer string) string {
	hb, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	exp := float64(now.Add(ttl).Unix())
	pb, _ := json.Marshal(payload{Sub: sub, Exp: &exp, Iss: issuer})
	input := b64.EncodeToString(hb) + "." + b64.EncodeToString(pb)
	return input + "." + b64.EncodeToString(sign(secret, input))
}
