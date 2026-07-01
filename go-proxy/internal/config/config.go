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

type Valkey struct {
	URL      string          `json:"-"`
	Sentinel *ValkeySentinel `json:"-"`
}

type File struct {
	ValkeyURL         string          `json:"valkeyUrl"`
	ValkeySentinel    *ValkeySentinel `json:"valkeySentinel"`
	ProxyPort         int             `json:"proxyPort"`
	AdminPort         int             `json:"adminPort"`
	ProxyTimeoutMs    int             `json:"proxyTimeoutMs"`
	AllowedClientIps  []string        `json:"allowedClientIps"`
	TrustProxyHeaders bool            `json:"trustProxyHeaders"`
	SessionHeader     string          `json:"sessionHeader"`
	TLS               TLS             `json:"tls"`
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
		ValkeyURL:         "redis://127.0.0.1:6379",
		ProxyPort:         8081,
		AdminPort:         9001,
		ProxyTimeoutMs:    30000,
		AllowedClientIps:  []string{"127.0.0.1", "::1"},
		TrustProxyHeaders: false,
		SessionHeader:     "X-Session-ID",
	}
}

func buildValkeyConfig(file File) Valkey {
	valkey := Valkey{URL: file.ValkeyURL}
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
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	cfg := defaultFile()
	if err := json.Unmarshal(raw, &cfg); err != nil {
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
	if len(cfg.AllowedClientIps) == 0 {
		cfg.AllowedClientIps = defaultFile().AllowedClientIps
	}
	if cfg.SessionHeader == "" {
		cfg.SessionHeader = defaultFile().SessionHeader
	}

	return &Loaded{
		Path:   path,
		File:   cfg,
		Valkey: buildValkeyConfig(cfg),
	}, nil
}
