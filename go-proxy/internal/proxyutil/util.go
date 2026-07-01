package proxyutil

import (
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

func SessionID(r *http.Request, sessionHeader string) string {
	return strings.TrimSpace(r.Header.Get(sessionHeader))
}
