// mint-token prints a development JWT. In production tokens come from your
// identity provider; this exists so you can call the API locally.
//
//	JWT_SECRET=... go run ./cmd/mint-token -sub 11111111-1111-4111-8111-111111111111
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"keycodes.dev/gateway/internal/jwtauth"
)

func main() {
	sub := flag.String("sub", "", "user id (UUID)")
	ttl := flag.Duration("ttl", time.Hour, "token lifetime")
	iss := flag.String("iss", os.Getenv("JWT_ISSUER"), "issuer (optional)")
	flag.Parse()

	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 || *sub == "" {
		fmt.Fprintln(os.Stderr, "usage: JWT_SECRET=<32+ chars> mint-token -sub <uuid> [-ttl 1h]")
		os.Exit(2)
	}
	fmt.Println(jwtauth.Sign(*sub, []byte(secret), time.Now(), *ttl, *iss))
}
