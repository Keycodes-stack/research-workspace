package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"keycodes.dev/gateway/internal/gateway"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil {
		return v
	}
	return def
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	aiURL, err := url.Parse(env("AI_URL", "http://localhost:8000"))
	if err != nil {
		log.Error("bad AI_URL", "err", err)
		os.Exit(1)
	}
	var origins []string
	for _, o := range strings.Split(os.Getenv("CORS_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}

	handler, err := gateway.New(gateway.Config{
		JWTSecret:     []byte(os.Getenv("JWT_SECRET")),
		Issuer:        os.Getenv("JWT_ISSUER"),
		AIURL:         aiURL,
		InternalToken: os.Getenv("INTERNAL_TOKEN"),
		CORSOrigins:   origins,
		RPS:           envFloat("RATE_LIMIT_RPS", 10),
		Burst:         int(envFloat("RATE_LIMIT_BURST", 60)),
		MaxBodyBytes:  int64(envFloat("MAX_BODY_MB", 55) * 1024 * 1024),
		Logger:        log,
	})
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute, // large PDF uploads
		WriteTimeout:      6 * time.Minute, // /ask runs several model calls
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		log.Info("gateway listening", "addr", srv.Addr, "ai", aiURL.String())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
