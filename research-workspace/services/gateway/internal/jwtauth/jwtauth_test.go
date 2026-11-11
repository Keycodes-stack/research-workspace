package jwtauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

var (
	secret = []byte("0123456789abcdef0123456789abcdef")
	now    = time.Unix(1_800_000_000, 0)
	user   = "11111111-1111-4111-8111-111111111111"
)

// craft builds a token with arbitrary header/payload, signed with key.
func craft(t *testing.T, header, pl map[string]any, key []byte) string {
	t.Helper()
	hb, _ := json.Marshal(header)
	pb, _ := json.Marshal(pl)
	in := b64.EncodeToString(hb) + "." + b64.EncodeToString(pb)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(in))
	return in + "." + b64.EncodeToString(mac.Sum(nil))
}

func hs256() map[string]any { return map[string]any{"alg": "HS256", "typ": "JWT"} }

func claims(over map[string]any) map[string]any {
	c := map[string]any{"sub": user, "exp": now.Add(time.Hour).Unix()}
	for k, v := range over {
		if v == nil {
			delete(c, k)
		} else {
			c[k] = v
		}
	}
	return c
}

func TestVerifyAcceptsValidToken(t *testing.T) {
	tok := Sign(user, secret, now, time.Hour, "")
	c, err := Verify(tok, secret, now, "")
	if err != nil || c.Subject != user {
		t.Fatalf("got %+v, %v", c, err)
	}
}

func TestSubjectIsNormalisedToLowercase(t *testing.T) {
	upper := strings.ToUpper(user)
	c, err := Verify(Sign(upper, secret, now, time.Hour, ""), secret, now, "")
	if err != nil || c.Subject != user {
		t.Fatalf("got %+v, %v", c, err)
	}
}

func TestVerifyRejects(t *testing.T) {
	good := Sign(user, secret, now, time.Hour, "")
	parts := strings.Split(good, ".")
	otherPayload := b64.EncodeToString([]byte(`{"sub":"22222222-2222-4222-8222-222222222222","exp":9999999999}`))

	tests := []struct {
		name  string
		token string
		want  error
	}{
		{"wrong secret", craft(t, hs256(), claims(nil), []byte("another-secret-another-secret-0000")), ErrSignature},
		{"tampered payload keeps old signature", parts[0] + "." + otherPayload + "." + parts[2], ErrSignature},
		{"alg none", b64.EncodeToString([]byte(`{"alg":"none"}`)) + "." + parts[1] + ".", ErrAlg},
		{"alg none with junk sig", b64.EncodeToString([]byte(`{"alg":"none"}`)) + "." + parts[1] + "." + parts[2], ErrAlg},
		{"alg HS512", craft(t, map[string]any{"alg": "HS512"}, claims(nil), secret), ErrAlg},
		{"alg RS256", craft(t, map[string]any{"alg": "RS256"}, claims(nil), secret), ErrAlg},
		{"expired", craft(t, hs256(), claims(map[string]any{"exp": now.Add(-time.Hour).Unix()}), secret), ErrExpired},
		{"missing exp", craft(t, hs256(), claims(map[string]any{"exp": nil}), secret), ErrClaims},
		{"not before in future", craft(t, hs256(), claims(map[string]any{"nbf": now.Add(time.Hour).Unix()}), secret), ErrNotYet},
		{"subject not a uuid", craft(t, hs256(), claims(map[string]any{"sub": "admin"}), secret), ErrClaims},
		{"missing subject", craft(t, hs256(), claims(map[string]any{"sub": nil}), secret), ErrClaims},
		{"two parts", "abc.def", ErrMalformed},
		{"four parts", good + ".x", ErrMalformed},
		{"empty", "", ErrMalformed},
		{"not base64", "!!!.!!!.!!!", ErrMalformed},
		{"oversized", strings.Repeat("a", maxTokenLen+1), ErrMalformed},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Verify(tc.token, secret, now, ""); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestExpiryLeewayAndNotBefore(t *testing.T) {
	justExpired := craft(t, hs256(), claims(map[string]any{"exp": now.Add(-10 * time.Second).Unix()}), secret)
	if _, err := Verify(justExpired, secret, now, ""); err != nil {
		t.Fatalf("10s past exp is within leeway: %v", err)
	}
	soonValid := craft(t, hs256(), claims(map[string]any{"nbf": now.Add(10 * time.Second).Unix()}), secret)
	if _, err := Verify(soonValid, secret, now, ""); err != nil {
		t.Fatalf("10s before nbf is within leeway: %v", err)
	}
}

func TestIssuer(t *testing.T) {
	tok := Sign(user, secret, now, time.Hour, "keycodes")
	if _, err := Verify(tok, secret, now, "keycodes"); err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(tok, secret, now, "someone-else"); !errors.Is(err, ErrClaims) {
		t.Fatalf("got %v", err)
	}
	if _, err := Verify(Sign(user, secret, now, time.Hour, ""), secret, now, "keycodes"); !errors.Is(err, ErrClaims) {
		t.Fatalf("missing issuer should fail when one is required: %v", err)
	}
	if _, err := Verify(tok, secret, now, ""); err != nil { // issuer not enforced when unset
		t.Fatal(err)
	}
}
