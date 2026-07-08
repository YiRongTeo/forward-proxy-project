package main

import (
	"flag"
	"log"
	"net/http"
	"strconv"
	"time"

	"go-proxy/internal/admin"
	"go-proxy/internal/allowlist"
	"go-proxy/internal/config"
	"go-proxy/internal/proxy"
	"go-proxy/internal/session"
	"go-proxy/internal/tlsconfig"
)

func startServer(server *http.Server, label, port string, tls tlsconfig.Config, configPath string) {
	go func() {
		log.Printf(`{"msg":%q,"port":%q,"tls":%t,"config":%q}`, label, port, tls.Enabled, configPath)
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
	configFlag := flag.String("config", "", "path to config JSON file")
	flag.Parse()

	configPath, err := config.ResolvePath(*configFlag)
	if err != nil {
		log.Fatal(err)
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatal(err)
	}

	tls := tlsconfig.Load(cfg.TLS)

	store, err := session.NewStore(cfg.Valkey, session.StoreOptions{
		SessionsPrefix:   cfg.ValkeySessionsPrefix,
		PositiveCacheTTL: time.Duration(cfg.SessionCachePositiveTtlMs) * time.Millisecond,
		NegativeCacheTTL: time.Duration(cfg.SessionCacheNegativeTtlMs) * time.Millisecond,
		Client: session.ClientOptions{
			PoolSize:     cfg.ValkeyPoolSize,
			MinIdleConns: cfg.ValkeyMinIdleConns,
			PoolTimeout:  time.Duration(cfg.ValkeyPoolTimeoutMs) * time.Millisecond,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf(`{"msg":"valkey connected","mode":%q}`, store.ConnectionMode())

	allow, err := allowlist.Parse(cfg.AllowedClientIps)
	if err != nil {
		log.Fatal(err)
	}

	proxyCfg := &proxy.Config{
		Allowlist:         allow,
		TrustProxyHeaders: cfg.TrustProxyHeaders,
		SessionStore:      store,
		PublicDomains:     cfg.PublicDomains,
		RequireProxyAuth:  cfg.RequireProxyAuth,
		Timeout:           time.Duration(cfg.ProxyTimeoutMs) * time.Millisecond,
		ValkeyTimeout:     time.Duration(cfg.ValkeyTimeoutMs) * time.Millisecond,
	}

	proxyPort := strconv.Itoa(cfg.ProxyPort)
	adminPort := strconv.Itoa(cfg.AdminPort)

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

	startServer(proxyServer, "go forward proxy listening", proxyPort, tls, cfg.Path)

	log.Printf(`{"msg":"go admin API listening","port":%q,"tls":%t,"config":%q}`, adminPort, tls.Enabled, cfg.Path)
	if tls.Enabled {
		if err := adminServer.ListenAndServeTLS(tls.CertFile, tls.KeyFile); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	} else if err := adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
