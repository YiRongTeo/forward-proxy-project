package admin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/yirongteo/forward-proxy-project/go-proxy/internal/proxyutil"
	"github.com/yirongteo/forward-proxy-project/go-proxy/internal/session"
)

type Server struct {
	Store *session.Store
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/health":
		if err := s.Store.Ping(context.Background()); err != nil {
			proxyutil.WriteJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"status": "error", "message": err.Error()})
			return
		}
		proxyutil.WriteJSON(w, http.StatusOK, map[string]interface{}{"status": "ok"})
		return
	case r.Method == http.MethodPost && r.URL.Path == "/sessions":
		s.createSession(w, r)
		return
	}

	if strings.HasPrefix(r.URL.Path, "/sessions/") {
		id := strings.TrimPrefix(r.URL.Path, "/sessions/")
		id = strings.TrimSuffix(id, "/")
		switch r.Method {
		case http.MethodGet:
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
		case http.MethodDelete:
			ok, err := s.Store.DeleteSession(context.Background(), id)
			if err != nil {
				proxyutil.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "internal_error"})
				return
			}
			if !ok {
				proxyutil.WriteJSON(w, http.StatusNotFound, map[string]interface{}{"error": "session_not_found"})
				return
			}
			proxyutil.WriteJSON(w, http.StatusOK, map[string]interface{}{"deleted": true, "id": id})
			return
		}
	}

	proxyutil.WriteJSON(w, http.StatusNotFound, map[string]interface{}{"error": "not_found"})
}

type createBody struct {
	ID         string                 `json:"id"`
	Domain     string                 `json:"domain"`
	TTLSeconds int                    `json:"ttlSeconds"`
	Metadata   map[string]interface{} `json:"metadata"`
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		proxyutil.WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_json"})
		return
	}
	var body createBody
	if err := json.Unmarshal(raw, &body); err != nil {
		proxyutil.WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_json", "message": err.Error()})
		return
	}
	if strings.TrimSpace(body.Domain) == "" {
		proxyutil.WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "domain_required"})
		return
	}
	created, err := s.Store.CreateSession(context.Background(), session.CreateInput{
		ID:         body.ID,
		Domain:     body.Domain,
		TTLSeconds: body.TTLSeconds,
		Metadata:   body.Metadata,
	})
	if err != nil {
		proxyutil.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "internal_error", "message": err.Error()})
		return
	}
	proxyutil.WriteJSON(w, http.StatusCreated, created)
}
