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

func StripHopByHop(headers http.Header) http.Header {
	out := make(http.Header)
	for k, vals := range headers {
		if _, skip := hopByHop[strings.ToLower(k)]; skip {
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

func WriteProxyAuthRequired(w http.ResponseWriter, body interface{}) {
	w.Header().Set("Proxy-Authenticate", `Basic realm="forward-proxy"`)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusProxyAuthRequired)
	_ = json.NewEncoder(w).Encode(body)
}

func LogEvent(fields map[string]interface{}) {
	fields["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	payload, _ := json.Marshal(fields)
	log.Println(string(payload))
}

func ProxyAuthCredentials(r *http.Request) (username, password string, ok bool) {
	auth := r.Header.Get("Proxy-Authorization")
	if !strings.HasPrefix(auth, "Basic ") {
		return "", "", false
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(auth[6:]))
	if err != nil {
		return "", "", false
	}

	parts := strings.SplitN(string(decoded), ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	username = strings.TrimSpace(parts[0])
	password = parts[1]
	if username == "" {
		return "", "", false
	}
	return username, password, true
}

func HasProxyAuth(r *http.Request) bool {
	_, _, ok := ProxyAuthCredentials(r)
	return ok
}
