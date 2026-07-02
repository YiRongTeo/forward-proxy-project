package allowlist

import (
	"net"
	"net/http"
	"strings"
)

type Rule struct {
	network *net.IPNet
	ip      net.IP
	single  bool
}

type Allowlist struct {
	rules []Rule
}

func Parse(entries []string) (*Allowlist, error) {
	a := &Allowlist{}
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			_, network, err := net.ParseCIDR(entry)
			if err != nil {
				return nil, err
			}
			a.rules = append(a.rules, Rule{network: network})
		} else {
			ip := net.ParseIP(entry)
			if ip == nil {
				continue
			}
			a.rules = append(a.rules, Rule{ip: ip, single: true})
		}
	}
	return a, nil
}

func normalizeIP(raw string) net.IP {
	ip := net.ParseIP(raw)
	if ip == nil {
		return nil
	}
	if v4 := ip.To4(); v4 != nil {
		return v4
	}
	return ip
}

func (a *Allowlist) ClientIP(r *http.Request, remoteAddr string, trustProxy bool) net.IP {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := normalizeIP(strings.TrimSpace(parts[0])); ip != nil {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return normalizeIP(remoteAddr)
	}
	return normalizeIP(host)
}

func (a *Allowlist) Allowed(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, rule := range a.rules {
		if rule.single {
			if rule.ip.Equal(ip) {
				return true
			}
			continue
		}
		if rule.network.Contains(ip) {
			return true
		}
	}
	return false
}

func (a *Allowlist) IsAllowed(r *http.Request, remoteAddr string, trustProxy bool) bool {
	return a.Allowed(a.ClientIP(r, remoteAddr, trustProxy))
}
