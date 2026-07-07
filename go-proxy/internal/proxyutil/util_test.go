package proxyutil

import (
	"encoding/base64"
	"net/http"
	"testing"
)

func TestProxyAuthCredentials(t *testing.T) {
	req, _ := http.NewRequest(http.MethodConnect, "https://example.com", nil)
	req.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("alice:s3cret")))

	user, pass, ok := ProxyAuthCredentials(req)
	if !ok {
		t.Fatal("expected credentials")
	}
	if user != "alice" || pass != "s3cret" {
		t.Fatalf("got %q:%q", user, pass)
	}
}

func TestProxyAuthCredentialsMissingPassword(t *testing.T) {
	req, _ := http.NewRequest(http.MethodConnect, "https://example.com", nil)
	req.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("alice")))

	if _, _, ok := ProxyAuthCredentials(req); ok {
		t.Fatal("expected missing password to fail")
	}
}

func TestHasProxyAuth(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	if HasProxyAuth(req) {
		t.Fatal("expected no proxy auth")
	}
	req.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("alice:s3cret")))
	if !HasProxyAuth(req) {
		t.Fatal("expected proxy auth")
	}
}
