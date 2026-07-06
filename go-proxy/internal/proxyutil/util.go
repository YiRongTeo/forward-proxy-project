package proxyutil

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

var hopByHop = map[string]struct{}{
	"connection":          {},
	"keep-alive":          {},
	"proxy-authenticate":  {},
	"proxy-authorization": {},
	"te":                  {},
	"trailers":            {},
	"transfer-encoding":   {},
	"upgrade":             {},
}

func StripHopByHop(headers http.Header, sessionHeader string) http.Header {
	out := make(http.Header)
	sessionLower := strings.ToLower(sessionHeader)
	for k, vals := range headers {
		lower := strings.ToLower(k)
		if _, skip := hopByHop[lower]; skip {
			continue
		}
		if lower == sessionLower {
			continue
		}
		out[k] = vals
	}
	return out
}

func WriteJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func LogEvent(fields map[string]interface{}) {
	fields["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	payload, _ := json.Marshal(fields)
	log.Println(string(payload))
}

func SessionIDFromHeader(r *http.Request, sessionHeader string) string {
	candidates := []string{sessionHeader, "X-Session-ID", "x-session-id"}
	for _, name := range candidates {
		if id := strings.TrimSpace(r.Header.Get(name)); id != "" {
			return id
		}
	}
	return ""
}

func SessionIDFromProxyAuth(r *http.Request) string {
	auth := r.Header.Get("Proxy-Authorization")
	if !strings.HasPrefix(auth, "Basic ") {
		return ""
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(auth[6:]))
	if err != nil {
		return ""
	}

	parts := strings.SplitN(string(decoded), ":", 2)
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func ResolveSessionID(r *http.Request, sessionHeader string, acceptProxyAuth bool) string {
	if id := SessionIDFromHeader(r, sessionHeader); id != "" {
		return id
	}
	if acceptProxyAuth {
		return SessionIDFromProxyAuth(r)
	}
	return ""
}
