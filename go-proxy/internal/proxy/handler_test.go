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
		Allowlist:                allow,
		RequireSessionFromHeader: false,
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

func TestAuthorizeHeaderModeMissingSession(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:                allow,
		RequireSessionFromHeader: true,
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	auth := cfg.authorize(req, "127.0.0.1:1234", "google.com")
	if auth.ok {
		t.Fatal("expected missing session to deny")
	}
	if auth.errorCode != "missing_session_id" {
		t.Fatalf("expected missing_session_id, got %+v", auth)
	}
	if auth.status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", auth.status)
	}
}

func TestAuthorizeHeaderModeReadsHeaderOnly(t *testing.T) {
	allow, err := allowlist.Parse([]string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		Allowlist:                allow,
		RequireSessionFromHeader: true,
		SessionHeader:            "X-Session-ID",
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	req.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjEyMzQ6c2Vzc2lvbg==")
	auth := cfg.authorize(req, "127.0.0.1:1234", "google.com")
	if auth.ok {
		t.Fatal("proxy auth should not satisfy header-only mode without session store")
	}
	if auth.errorCode != "missing_session_id" {
		t.Fatalf("expected missing_session_id, got %+v", auth)
	}
}

func TestResolveSessionIDAcceptsProxyAuth(t *testing.T) {
	cfg := &Config{
		SessionHeader:              "X-Session-ID",
		AcceptSessionFromProxyAuth: true,
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	req.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjEyMzQ6c2Vzc2lvbg==")
	if got := cfg.resolveSessionID(req); got != "session1234" {
		t.Fatalf("expected session1234 from proxy auth, got %q", got)
	}
}

func TestResolveSessionIDIgnoresProxyAuthByDefault(t *testing.T) {
	cfg := &Config{
		SessionHeader:              "X-Session-ID",
		AcceptSessionFromProxyAuth: false,
	}

	req := &http.Request{Method: http.MethodConnect, Header: make(http.Header)}
	req.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjEyMzQ6c2Vzc2lvbg==")
	if got := cfg.resolveSessionID(req); got != "" {
		t.Fatalf("expected empty session id, got %q", got)
	}
}
