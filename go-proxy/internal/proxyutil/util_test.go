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
	if got := SessionID(req, "X-Session-ID"); got != "session1234" {
		t.Fatalf("SessionID should prefer header, got %q", got)
	}

	req2, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	req2.Header.Set("Proxy-Authorization", "Basic c2Vzc2lvbjk5OTk6c2Vzc2lvbg==")
	if got := SessionIDFromHeader(req2, "X-Session-ID"); got != "" {
		t.Fatalf("SessionIDFromHeader should ignore proxy auth, got %q", got)
	}
}
