package admin

import (
	"context"
	"net/http"
	"strings"

	"go-proxy/internal/proxyutil"
	"go-proxy/internal/session"
)

type Server struct {
	Store *session.Store
	TLS   bool
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/health":
		if err := s.Store.Ping(context.Background()); err != nil {
			proxyutil.WriteJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"status": "error", "message": err.Error()})
			return
		}
		proxyutil.WriteJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "tls": s.TLS})
		return
	}

	if strings.HasPrefix(r.URL.Path, "/sessions/") && r.Method == http.MethodGet {
		id := strings.TrimPrefix(r.URL.Path, "/sessions/")
		id = strings.TrimSuffix(id, "/")
		sess, err := s.Store.GetSession(context.Background(), id)
		if err != nil {
			proxyutil.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "internal_error"})
			return
		}
		if sess == nil {
			proxyutil.WriteJSON(w, http.StatusNotFound, map[string]interface{}{"error": "session_not_found"})
			return
		}
		proxyutil.WriteJSON(w, http.StatusOK, map[string]interface{}{"id": id, "domain": sess.Domain, "createdAt": sess.CreatedAt, "metadata": sess.Metadata})
		return
	}

	if r.Method == http.MethodPost || r.Method == http.MethodDelete || r.Method == http.MethodPut || r.Method == http.MethodPatch {
		proxyutil.WriteJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{
			"error":   "method_not_allowed",
			"message": "Sessions are read-only via the proxy",
		})
		return
	}

	proxyutil.WriteJSON(w, http.StatusNotFound, map[string]interface{}{"error": "not_found"})
}
