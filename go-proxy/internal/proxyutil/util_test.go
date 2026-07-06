package proxyutil

import (
	"net/http"
	"testing"
)

func TestSessionIDFromHeader(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	req.Header.Set("X-Session-ID", "session1234")
	req.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjk5OTk6c2Vzc2lvbg==")

	if got := SessionIDFromHeader(req, "X-Session-ID"); got != "session1234" {
		t.Fatalf("SessionIDFromHeader = %q, want session1234", got)
	}
}

func TestSessionIDFromProxyAuth(t *testing.T) {
	req, _ := http.NewRequest(http.MethodConnect, "https://example.com", nil)
	req.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjk5OTk6c2Vzc2lvbg==")

	if got := SessionIDFromProxyAuth(req); got != "session9999" {
		t.Fatalf("SessionIDFromProxyAuth = %q, want session9999", got)
	}
}

func TestResolveSessionID(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	req.Header.Set("X-Session-ID", "session1234")
	req.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjk5OTk6c2Vzc2lvbg==")

	if got := ResolveSessionID(req, "X-Session-ID", false); got != "session1234" {
		t.Fatalf("ResolveSessionID should prefer header, got %q", got)
	}

	req2, _ := http.NewRequest(http.MethodConnect, "https://example.com", nil)
	req2.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjk5OTk6c2Vzc2lvbg==")

	if got := ResolveSessionID(req2, "X-Session-ID", false); got != "" {
		t.Fatalf("ResolveSessionID should ignore proxy auth when disabled, got %q", got)
	}
	if got := ResolveSessionID(req2, "X-Session-ID", true); got != "session9999" {
		t.Fatalf("ResolveSessionID should read proxy auth when enabled, got %q", got)
	}
}
