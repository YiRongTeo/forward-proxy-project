package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"go-proxy/internal/admin"
	"go-proxy/internal/allowlist"
	"go-proxy/internal/proxy"
	"go-proxy/internal/session"
	"go-proxy/internal/tlsconfig"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func startServer(server *http.Server, label, port string, tls tlsconfig.Config) {
	go func() {
		log.Printf(`{"msg":%q,"port":%q,"tls":%t}`, label, port, tls.Enabled)
		var err error
		if tls.Enabled {
			err = server.ListenAndServeTLS(tls.CertFile, tls.KeyFile)
		} else {
			err = server.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
}

func main() {
	valkeyURL := env("VALKEY_URL", "redis://127.0.0.1:6379")
	timeoutMs, _ := strconv.Atoi(env("PROXY_TIMEOUT_MS", "30000"))
	allowedIPs := strings.Split(env("ALLOWED_CLIENT_IPS", "127.0.0.1,::1"), ",")
	trustProxy := env("TRUST_PROXY_HEADERS", "false") == "true"
	sessionHeader := env("SESSION_HEADER", "X-Session-ID")
	proxyPort := env("PROXY_PORT", "8081")
	adminPort := env("ADMIN_PORT", "9001")
	tls := tlsconfig.LoadFromEnv()

	store, err := session.NewStore(valkeyURL)
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
		Addr: "0.0.0.0:" + adminPort,
		Handler: &admin.Server{
			Store: store,
			TLS:   tls.Enabled,
		},
	}

	startServer(proxyServer, "go forward proxy listening", proxyPort, tls)

	log.Printf(`{"msg":"go admin API listening","port":%q,"tls":%t}`, adminPort, tls.Enabled)
	if tls.Enabled {
		if err := adminServer.ListenAndServeTLS(tls.CertFile, tls.KeyFile); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	} else if err := adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
