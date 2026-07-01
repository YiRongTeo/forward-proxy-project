package domain

import "strings"

func NormalizeHost(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return ""
	}
	if strings.HasPrefix(h, "[") {
		if end := strings.Index(h, "]"); end != -1 {
			return h[1:end]
		}
	}
	if i := strings.LastIndex(h, ":"); i != -1 && strings.Index(h, ":") == i {
		return h[:i]
	}
	return h
}

func HostAllowed(requestedHost, sessionDomain string) bool {
	host := NormalizeHost(requestedHost)
	domain := NormalizeHost(sessionDomain)
	if host == "" || domain == "" {
		return false
	}
	return host == domain || strings.HasSuffix(host, "."+domain)
}
