package tlsconfig

import (
	"log"
	"os"
)

type Config struct {
	Enabled  bool
	CertFile string
	KeyFile  string
}

func LoadFromEnv() Config {
	certFile := os.Getenv("TLS_CERT_FILE")
	keyFile := os.Getenv("TLS_KEY_FILE")
	if certFile == "" || keyFile == "" {
		return Config{}
	}
	if _, err := os.Stat(certFile); err != nil {
		log.Printf(`{"msg":"TLS cert file not available","path":%q}`, certFile)
		return Config{}
	}
	if _, err := os.Stat(keyFile); err != nil {
		log.Printf(`{"msg":"TLS key file not available","path":%q}`, keyFile)
		return Config{}
	}
	return Config{Enabled: true, CertFile: certFile, KeyFile: keyFile}
}
