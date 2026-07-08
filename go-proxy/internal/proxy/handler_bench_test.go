package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"go-proxy/internal/allowlist"
)

func BenchmarkAuthorize_PublicHost(b *testing.B) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		b.Fatal(err)
	}
	cfg := &Config{
		Allowlist:        allow,
		RequireProxyAuth: true,
		PublicDomains:    []string{"example.com"},
	}
	req := httptest.NewRequest(http.MethodConnect, "http://example.com", nil)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		auth := cfg.authorize(req, "127.0.0.1:1234", "www.example.com")
		if !auth.ok {
			b.Fatal("expected public access")
		}
	}
}

func BenchmarkAuthorize_MissingCredentials(b *testing.B) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		b.Fatal(err)
	}
	cfg := &Config{
		Allowlist:        allow,
		RequireProxyAuth: true,
	}
	req := httptest.NewRequest(http.MethodConnect, "http://example.com", nil)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cfg.authorize(req, "127.0.0.1:1234", "www.example.com")
	}
}
