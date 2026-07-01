package tlsconfig

import (
	"log"
	"os"

	"go-proxy/internal/config"
)

type Config struct {
	Enabled  bool
	CertFile string
	KeyFile  string
}

func Load(cfg config.TLS) Config {
	if cfg.CertFile == "" || cfg.KeyFile == "" {
		return Config{}
	}
	if _, err := os.Stat(cfg.CertFile); err != nil {
		log.Printf(`{"msg":"TLS cert file not available","path":%q}`, cfg.CertFile)
		return Config{}
	}
	if _, err := os.Stat(cfg.KeyFile); err != nil {
		log.Printf(`{"msg":"TLS key file not available","path":%q}`, cfg.KeyFile)
		return Config{}
	}
	return Config{Enabled: true, CertFile: cfg.CertFile, KeyFile: cfg.KeyFile}
}
