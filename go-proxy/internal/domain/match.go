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

func IsPublicHost(requestedHost string, publicDomains []string) bool {
	for _, allowed := range publicDomains {
		if HostAllowed(requestedHost, allowed) {
			return true
		}
	}
	return false
}

// HostSuffixCandidates returns host suffixes from most specific to least (e.g. www.google.com, google.com).
func HostSuffixCandidates(requestedHost string) []string {
	host := NormalizeHost(requestedHost)
	if host == "" {
		return nil
	}
	var out []string
	for h := host; h != ""; {
		out = append(out, h)
		i := strings.Index(h, ".")
		if i == -1 {
			break
		}
		h = h[i+1:]
	}
	return out
}
