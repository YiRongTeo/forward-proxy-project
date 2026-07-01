package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"go-proxy/internal/allowlist"
	"go-proxy/internal/domain"
	"go-proxy/internal/proxyutil"
	"go-proxy/internal/session"
)

type Config struct {
	Allowlist             *allowlist.Allowlist
	TrustProxyHeaders     bool
	SessionStore          *session.Store
	SessionHeader         string
	DefaultAllowedDomains []string
	Timeout               time.Duration
}

type authResult struct {
	ok            bool
	status        int
	errorCode     string
	sessionID     string
	session       *session.Session
	requestedHost string
	authRequired  bool
}

func (c *Config) authorize(r *http.Request, remoteAddr, requestedHost string) authResult {
	if !c.Allowlist.IsAllowed(r, remoteAddr, c.TrustProxyHeaders) {
		return authResult{ok: false, status: http.StatusForbidden, errorCode: "ip_not_allowed", requestedHost: requestedHost}
	}
	sessionID := proxyutil.SessionID(r, c.SessionHeader)
	if sessionID == "" {
		return authResult{ok: false, status: http.StatusProxyAuthRequired, errorCode: "missing_session_id", requestedHost: requestedHost, authRequired: true}
	}
	sess, err := c.SessionStore.GetSession(context.Background(), sessionID)
	if err != nil {
		return authResult{ok: false, status: http.StatusBadGateway, errorCode: "internal_error", sessionID: sessionID, requestedHost: requestedHost}
	}
	if sess == nil {
		return authResult{ok: false, status: http.StatusNotFound, errorCode: "session_not_found", sessionID: sessionID, requestedHost: requestedHost}
	}
	return authResult{ok: true, sessionID: sessionID, session: sess, requestedHost: requestedHost}
}

func parseConnectTarget(target string) (host string, port string) {
	target = strings.TrimSpace(target)
	host = target
	port = "443"
	if strings.HasPrefix(target, "[") {
		if end := strings.Index(target, "]"); end != -1 {
			host = target[1:end]
			rest := target[end+1:]
			if strings.HasPrefix(rest, ":") {
				port = strings.TrimPrefix(rest, ":")
			}
		}
		return host, port
	}
	if i := strings.LastIndex(target, ":"); i != -1 {
		host = target[:i]
		port = target[i+1:]
	}
	return host, port
}

func connectTarget(r *http.Request) (host string, port string) {
	if r.Method == http.MethodConnect && r.RequestURI != "" {
		return parseConnectTarget(r.RequestURI)
	}
	if r.URL.Host != "" {
		return parseConnectTarget(r.URL.Host)
	}
	return parseConnectTarget(r.Host)
}

func (c *Config) logConnectEvent(start time.Time, clientIP string, auth authResult, host string, allowed bool, errCode string, extra map[string]interface{}) {
	fields := map[string]interface{}{
		"clientIp":      clientIP,
		"sessionId":     auth.sessionID,
		"requestedHost": host,
		"allowed":       allowed,
		"method":        "CONNECT",
		"latencyMs":     time.Since(start).Milliseconds(),
	}
	if errCode != "" {
		fields["error"] = errCode
	}
	if auth.session != nil {
		fields["sessionDomain"] = auth.session.Domain
	}
	for key, value := range extra {
		fields[key] = value
	}
	proxyutil.LogEvent(fields)
}

func (c *Config) HandleConnect(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	host, port := connectTarget(r)
	clientIP := c.Allowlist.ClientIP(r, r.RemoteAddr, c.TrustProxyHeaders).String()

	auth := c.authorize(r, r.RemoteAddr, host)

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		proxyutil.WriteJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "hijack_not_supported"})
		return
	}

	clientConn, bufrw, err := hijacker.Hijack()
	if err != nil {
		proxyutil.WriteJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "hijack_failed"})
		return
	}
	defer clientConn.Close()

	if !auth.ok {
		if auth.authRequired {
			_ = proxyutil.WriteConnectProxyAuthRequiredRaw(clientConn)
		} else {
			body := map[string]interface{}{
				"error":         auth.errorCode,
				"requestedHost": host,
			}
			if auth.sessionID != "" {
				body["sessionId"] = auth.sessionID
			}
			_ = proxyutil.WriteConnectJSON(clientConn, auth.status, http.StatusText(auth.status), body)
		}
		c.logConnectEvent(start, clientIP, auth, host, false, auth.errorCode, map[string]interface{}{
			"hasSessionHeader": r.Header.Get("X-Session-ID") != "" || r.Header.Get("x-session-id") != "",
			"hasProxyAuth":     r.Header.Get("Proxy-Authorization") != "",
		})
		return
	}

	if !domain.RequestHostAllowed(host, auth.session.Domain, c.DefaultAllowedDomains) {
		_ = proxyutil.WriteConnectJSON(clientConn, http.StatusForbidden, http.StatusText(http.StatusForbidden), map[string]interface{}{
			"error":         "domain_not_allowed",
			"sessionDomain": auth.session.Domain,
			"requestedHost": host,
			"sessionId":     auth.sessionID,
		})
		c.logConnectEvent(start, clientIP, auth, host, false, "domain_not_allowed", nil)
		return
	}

	upstreamAddr := net.JoinHostPort(host, port)
	upstreamConn, err := net.DialTimeout("tcp", upstreamAddr, c.Timeout)
	if err != nil {
		_ = proxyutil.WriteConnectJSON(clientConn, http.StatusBadGateway, http.StatusText(http.StatusBadGateway), map[string]interface{}{
			"error":         "upstream_unreachable",
			"requestedHost": host,
		})
		c.logConnectEvent(start, clientIP, auth, host, true, "upstream_unreachable", nil)
		return
	}
	defer upstreamConn.Close()

	if err := proxyutil.WriteConnectEstablished(clientConn); err != nil {
		c.logConnectEvent(start, clientIP, auth, host, true, "connect_response_failed", nil)
		return
	}

	if err := proxyutil.ForwardBuffered(bufrw.Reader, upstreamConn); err != nil {
		c.logConnectEvent(start, clientIP, auth, host, true, "buffer_forward_failed", nil)
		return
	}

	go pipe(upstreamConn, clientConn)
	pipe(clientConn, upstreamConn)
	c.logConnectEvent(start, clientIP, auth, host, true, "", nil)
}

func pipe(dst net.Conn, src net.Conn) {
	_, _ = io.Copy(dst, src)
}

func (c *Config) HandleHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	targetURL := r.RequestURI
	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		proxyutil.WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_request_url"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		proxyutil.WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_request_url"})
		return
	}
	req.Host = r.Host
	req.Header = r.Header.Clone()

	requestedHost := req.URL.Hostname()
	auth := c.authorize(r, r.RemoteAddr, requestedHost)
	if !auth.ok {
		if auth.authRequired {
			proxyutil.WriteProxyAuthRequired(w, map[string]interface{}{"error": auth.errorCode})
		} else {
			proxyutil.WriteJSON(w, auth.status, map[string]interface{}{"error": auth.errorCode, "sessionId": auth.sessionID})
		}
		proxyutil.LogEvent(map[string]interface{}{"clientIp": r.RemoteAddr, "sessionId": auth.sessionID, "allowed": false, "method": r.Method, "latencyMs": time.Since(start).Milliseconds(), "error": auth.errorCode})
		return
	}
	if !domain.RequestHostAllowed(requestedHost, auth.session.Domain, c.DefaultAllowedDomains) {
		proxyutil.WriteJSON(w, http.StatusForbidden, map[string]interface{}{"error": "domain_not_allowed", "sessionDomain": auth.session.Domain, "requestedHost": requestedHost, "sessionId": auth.sessionID})
		proxyutil.LogEvent(map[string]interface{}{"clientIp": r.RemoteAddr, "sessionId": auth.sessionID, "sessionDomain": auth.session.Domain, "requestedHost": requestedHost, "allowed": false, "method": r.Method, "latencyMs": time.Since(start).Milliseconds(), "error": "domain_not_allowed"})
		return
	}

	req.Header = proxyutil.StripHopByHop(req.Header, c.SessionHeader)
	req.Header.Set("Host", req.URL.Host)

	client := &http.Client{Timeout: c.Timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		proxyutil.WriteJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "upstream_unreachable"})
		proxyutil.LogEvent(map[string]interface{}{"clientIp": r.RemoteAddr, "sessionId": auth.sessionID, "requestedHost": requestedHost, "allowed": true, "method": r.Method, "latencyMs": time.Since(start).Milliseconds(), "error": "upstream_unreachable"})
		return
	}
	defer resp.Body.Close()

	outHeader := proxyutil.StripHopByHop(resp.Header, c.SessionHeader)
	for k, vals := range outHeader {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
	proxyutil.LogEvent(map[string]interface{}{"clientIp": r.RemoteAddr, "sessionId": auth.sessionID, "sessionDomain": auth.session.Domain, "requestedHost": requestedHost, "allowed": true, "method": r.Method, "latencyMs": time.Since(start).Milliseconds(), "status": resp.StatusCode})
}

func (c *Config) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		c.HandleConnect(w, r)
		return
	}
	c.HandleHTTP(w, r)
}

func WriteConnectError(conn net.Conn, status int, body map[string]interface{}) error {
	payload, _ := json.Marshal(body)
	msg := fmt.Sprintf("HTTP/1.1 %d Error\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", status, len(payload), payload)
	_, err := conn.Write([]byte(msg))
	return err
}
