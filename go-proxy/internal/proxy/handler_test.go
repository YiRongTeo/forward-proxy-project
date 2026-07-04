package proxy

import (
	"net/http"
	"testing"

	"go-proxy/internal/allowlist"
)

func TestAuthorizePublicHostSkipsSession(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:     allow,
		PublicDomains: []string{"example.com"},
	}

	req := &http.Request{
		Method: http.MethodConnect,
		Host:   "example.com:443",
		Header: make(http.Header),
	}
	req.RequestURI = "example.com:443"

	auth := cfg.authorize(req, "127.0.0.1:1234", "example.com")
	if !auth.ok {
		t.Fatalf("expected public host to authorize without session, got %+v", auth)
	}
	if !auth.publicAccess {
		t.Fatal("expected publicAccess=true")
	}
	if cfg.authMode(auth) != "public" {
		t.Fatalf("expected authMode public, got %s", cfg.authMode(auth))
	}
}

func TestAuthorizeProtectedHostRequiresSession(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:     allow,
		PublicDomains: []string{"example.com"},
	}

	req := &http.Request{
		Method: http.MethodConnect,
		Host:   "google.com:443",
		Header: make(http.Header),
	}
	req.RequestURI = "google.com:443"

	auth := cfg.authorize(req, "127.0.0.1:1234", "google.com")
	if auth.ok {
		t.Fatal("expected missing session to deny protected host")
	}
	if !auth.authRequired || auth.errorCode != "missing_session_id" {
		t.Fatalf("expected 407 missing_session_id, got %+v", auth)
	}
}
