package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type TLS struct {
	CertFile string `json:"certFile"`
	KeyFile  string `json:"keyFile"`
}

type ValkeySentinel struct {
	MasterName       string   `json:"masterName"`
	Sentinels        []string `json:"sentinels"`
	Password         string   `json:"password"`
	SentinelPassword string   `json:"sentinelPassword"`
	DB               int      `json:"db"`
}

type ValkeyTLS struct {
	Enabled            bool   `json:"enabled"`
	CAFile             string `json:"caFile"`
	CertFile           string `json:"certFile"`
	KeyFile            string `json:"keyFile"`
	ServerName         string `json:"serverName"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
}

type Valkey struct {
	URL      string          `json:"-"`
	Sentinel *ValkeySentinel `json:"-"`
	TLS      ValkeyTLS       `json:"-"`
}

type File struct {
	ValkeyURL                 string          `json:"valkeyUrl"`
	ValkeySentinel            *ValkeySentinel `json:"valkeySentinel"`
	ValkeyTLS                 ValkeyTLS       `json:"valkeyTls"`
	ProxyPort                 int             `json:"proxyPort"`
	AdminPort                 int             `json:"adminPort"`
	ProxyTimeoutMs            int             `json:"proxyTimeoutMs"`
	ValkeyTimeoutMs           int             `json:"valkeyTimeoutMs"`
	SessionCachePositiveTtlMs int             `json:"sessionCachePositiveTtlMs"`
	SessionCacheNegativeTtlMs int             `json:"sessionCacheNegativeTtlMs"`
	ValkeyPoolSize            int             `json:"valkeyPoolSize"`
	ValkeyMinIdleConns        int             `json:"valkeyMinIdleConns"`
	ValkeyPoolTimeoutMs       int             `json:"valkeyPoolTimeoutMs"`
	AllowedClientIps          []string        `json:"allowedClientIps"`
	PublicDomains             []string        `json:"publicDomains"`
	TrustProxyHeaders         bool            `json:"trustProxyHeaders"`
	ValkeySessionsPrefix      string          `json:"valkeySessionsPrefix"`
	RequireProxyAuth          bool            `json:"requireProxyAuth"`
	TLS                       TLS             `json:"tls"`
}

type Loaded struct {
	Path string
	File
	Valkey Valkey
}

func (v Valkey) UseSentinel() bool {
	return v.Sentinel != nil &&
		v.Sentinel.MasterName != "" &&
		len(v.Sentinel.Sentinels) > 0
}

func defaultFile() File {
	return File{
		ValkeyURL:                 "redis://127.0.0.1:6379",
		ProxyPort:                 8081,
		AdminPort:                 9001,
		ProxyTimeoutMs:            30000,
		ValkeyTimeoutMs:           2000,
		SessionCachePositiveTtlMs: 30000,
		SessionCacheNegativeTtlMs: 5000,
		ValkeyPoolSize:            50,
		ValkeyMinIdleConns:        10,
		ValkeyPoolTimeoutMs:       2000,
		AllowedClientIps:          []string{"127.0.0.1", "::1"},
		PublicDomains:             []string{},
		TrustProxyHeaders:         false,
		ValkeySessionsPrefix:      "sessions",
		RequireProxyAuth:          true,
	}
}

func buildValkeyConfig(file File) Valkey {
	valkey := Valkey{
		URL: file.ValkeyURL,
		TLS: file.ValkeyTLS,
	}
	if file.ValkeySentinel != nil &&
		file.ValkeySentinel.MasterName != "" &&
		len(file.ValkeySentinel.Sentinels) > 0 {
		sentinel := *file.ValkeySentinel
		valkey.Sentinel = &sentinel
	}
	return valkey
}

func ResolvePath(flagPath string) (string, error) {
	if flagPath != "" {
		return flagPath, nil
	}

	candidates := []string{
		"/config/config.json",
		filepath.Join(".", "config.json"),
		filepath.Join(".", "config", "go-proxy.json"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("config file not found: pass -config /path/to/config.json or mount /config/config.json")
}

func Load(path string) (*Loaded, error) {
	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	cfg := defaultFile()
	if err := json.Unmarshal(rawBytes, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.ValkeyURL == "" {
		cfg.ValkeyURL = defaultFile().ValkeyURL
	}
	if cfg.ProxyPort == 0 {
		cfg.ProxyPort = defaultFile().ProxyPort
	}
	if cfg.AdminPort == 0 {
		cfg.AdminPort = defaultFile().AdminPort
	}
	if cfg.ProxyTimeoutMs == 0 {
		cfg.ProxyTimeoutMs = defaultFile().ProxyTimeoutMs
	}
	if cfg.ValkeyTimeoutMs == 0 {
		cfg.ValkeyTimeoutMs = defaultFile().ValkeyTimeoutMs
	}
	if cfg.SessionCachePositiveTtlMs == 0 {
		cfg.SessionCachePositiveTtlMs = defaultFile().SessionCachePositiveTtlMs
	}
	if cfg.SessionCacheNegativeTtlMs == 0 {
		cfg.SessionCacheNegativeTtlMs = defaultFile().SessionCacheNegativeTtlMs
	}
	if cfg.ValkeyPoolSize == 0 {
		cfg.ValkeyPoolSize = defaultFile().ValkeyPoolSize
	}
	if cfg.ValkeyMinIdleConns == 0 {
		cfg.ValkeyMinIdleConns = defaultFile().ValkeyMinIdleConns
	}
	if cfg.ValkeyPoolTimeoutMs == 0 {
		cfg.ValkeyPoolTimeoutMs = defaultFile().ValkeyPoolTimeoutMs
	}
	if len(cfg.AllowedClientIps) == 0 {
		cfg.AllowedClientIps = defaultFile().AllowedClientIps
	}
	if cfg.PublicDomains == nil {
		cfg.PublicDomains = defaultFile().PublicDomains
	}
	if cfg.ValkeySessionsPrefix == "" {
		cfg.ValkeySessionsPrefix = defaultFile().ValkeySessionsPrefix
	}
	var rawFields map[string]json.RawMessage
	if err := json.Unmarshal(rawBytes, &rawFields); err == nil {
		if _, ok := rawFields["requireProxyAuth"]; !ok {
			cfg.RequireProxyAuth = true
		}
	}

	return &Loaded{
		Path:   path,
		File:   cfg,
		Valkey: buildValkeyConfig(cfg),
	}, nil
}
