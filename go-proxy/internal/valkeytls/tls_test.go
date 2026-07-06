package valkeytls_test

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"

	"go-proxy/internal/config"
	"go-proxy/internal/valkeytls"
)

func TestBuildDisabled(t *testing.T) {
	cfg, err := valkeytls.Build(config.ValkeyTLS{Enabled: false})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg != nil {
		t.Fatalf("expected nil TLS config when disabled")
	}
}

func TestBuildWithCA(t *testing.T) {
	dir := t.TempDir()
	caFile := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(caFile, []byte("not-a-real-ca"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := valkeytls.Build(config.ValkeyTLS{
		Enabled: true,
		CAFile:  caFile,
	})
	if err == nil {
		t.Fatalf("expected parse error for invalid CA PEM")
	}
}

func TestBuildInsecure(t *testing.T) {
	cfg, err := valkeytls.Build(config.ValkeyTLS{
		Enabled:            true,
		InsecureSkipVerify: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg == nil || !cfg.InsecureSkipVerify || cfg.MinVersion != tls.VersionTLS12 {
		t.Fatalf("unexpected tls config: %+v", cfg)
	}
}
