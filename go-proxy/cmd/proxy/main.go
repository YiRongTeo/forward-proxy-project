package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/yirongteo/forward-proxy-project/go-proxy/internal/admin"
	"github.com/yirongteo/forward-proxy-project/go-proxy/internal/allowlist"
	"github.com/yirongteo/forward-proxy-project/go-proxy/internal/proxy"
	"github.com/yirongteo/forward-proxy-project/go-proxy/internal/session"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	valkeyURL := env("VALKEY_URL", "redis://127.0.0.1:6379")
	sessionTTL, _ := strconv.Atoi(env("SESSION_TTL_SECONDS", "3600"))
	timeoutMs, _ := strconv.Atoi(env("PROXY_TIMEOUT_MS", "30000"))
	allowedIPs := strings.Split(env("ALLOWED_CLIENT_IPS", "127.0.0.1,::1"), ",")
	trustProxy := env("TRUST_PROXY_HEADERS", "false") == "true"
	sessionHeader := env("SESSION_HEADER", "X-Session-ID")
	proxyPort := env("PROXY_PORT", "8081")
	adminPort := env("ADMIN_PORT", "9001")

	store, err := session.NewStore(valkeyURL, sessionTTL)
	if err != nil {
		log.Fatal(err)
	}

	allow, err := allowlist.Parse(allowedIPs)
	if err != nil {
		log.Fatal(err)
	}

	proxyCfg := &proxy.Config{
		Allowlist:         allow,
		TrustProxyHeaders: trustProxy,
		SessionStore:      store,
		SessionHeader:     sessionHeader,
		Timeout:           time.Duration(timeoutMs) * time.Millisecond,
	}

	proxyServer := &http.Server{
		Addr:         "0.0.0.0:" + proxyPort,
		Handler:      proxyCfg,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	adminServer := &http.Server{
		Addr:    "0.0.0.0:" + adminPort,
		Handler: &admin.Server{Store: store},
	}

	go func() {
		log.Printf(`{"msg":"go forward proxy listening","port":"%s"}`, proxyPort)
		if err := proxyServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	log.Printf(`{"msg":"go admin API listening","port":"%s"}`, adminPort)
	if err := adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
