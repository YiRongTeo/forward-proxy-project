package proxy

import (
	"net/http"
	"testing"

	"go-proxy/internal/allowlist"
)

func TestAuthorizeOpenRelay(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:        allow,
		RequireProxyAuth: false,
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	auth := cfg.authorize(req, "127.0.0.1:1234", "google.com")
	if !auth.ok || !auth.openAccess {
		t.Fatalf("expected open relay, got %+v", auth)
	}
	if cfg.authMode(auth) != "open" {
		t.Fatalf("expected authMode open, got %s", cfg.authMode(auth))
	}
}

func TestAuthorizeMissingCredentials(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:        allow,
		RequireProxyAuth: true,
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	auth := cfg.authorize(req, "127.0.0.1:1234", "google.com")
	if auth.ok {
		t.Fatal("expected missing credentials to deny")
	}
	if auth.errorCode != "missing_credentials" {
		t.Fatalf("expected missing_credentials, got %+v", auth)
	}
	if auth.status != http.StatusProxyAuthRequired {
		t.Fatalf("expected status 407, got %d", auth.status)
	}
	if !auth.authRequired {
		t.Fatal("expected authRequired true")
	}
}

func TestAuthorizePublicHostSkipsSession(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:        allow,
		RequireProxyAuth: true,
		PublicDomains:    []string{"example.com"},
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	auth := cfg.authorize(req, "127.0.0.1:1234", "example.com")
	if !auth.ok || !auth.publicAccess {
		t.Fatalf("expected public host to authorize without credentials, got %+v", auth)
	}
}
