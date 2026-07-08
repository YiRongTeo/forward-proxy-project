package session

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go-proxy/internal/config"
	"go-proxy/internal/domain"
)

var ErrDomainNotAllowed = errors.New("domain_not_allowed")

type StoreOptions struct {
	SessionsPrefix   string
	PositiveCacheTTL time.Duration
	NegativeCacheTTL time.Duration
	Client           ClientOptions
}

type Store struct {
	client           *redis.Client
	mode             string
	prefix           string
	positiveCacheTTL time.Duration
	negativeCacheTTL time.Duration
	keyCache         map[string]keyCacheEntry
	resultCache      map[string]resultCacheEntry
	cacheMu          sync.RWMutex
}

type keyCacheEntry struct {
	exists    bool
	expiresAt time.Time
}

type resultCacheEntry struct {
	allowed       bool
	matchedDomain string
	expiresAt     time.Time
}

func NewStore(valkey config.Valkey, opts StoreOptions) (*Store, error) {
	client, err := NewValkeyClient(valkey, opts.Client)
	if err != nil {
		return nil, err
	}

	prefix := opts.SessionsPrefix
	if prefix == "" {
		prefix = "sessions"
	}

	positiveTTL := opts.PositiveCacheTTL
	if positiveTTL <= 0 {
		positiveTTL = 30 * time.Second
	}
	negativeTTL := opts.NegativeCacheTTL
	if negativeTTL <= 0 {
		negativeTTL = 5 * time.Second
	}

	return &Store{
		client:           client,
		mode:             ConnectionMode(valkey),
		prefix:           prefix,
		positiveCacheTTL: positiveTTL,
		negativeCacheTTL: negativeTTL,
		keyCache:         make(map[string]keyCacheEntry),
		resultCache:      make(map[string]resultCacheEntry),
	}, nil
}

func (s *Store) ConnectionMode() string {
	return s.mode
}

func (s *Store) domainKey(userSessionID, domain string) string {
	return s.prefix + ":" + userSessionID + ":" + domain
}

func (s *Store) authorizeCacheKey(userSessionID, requestedHost string) string {
	return userSessionID + ":" + domain.NormalizeHost(requestedHost)
}

func (s *Store) cacheTTL(exists bool) time.Duration {
	if exists {
		return s.positiveCacheTTL
	}
	return s.negativeCacheTTL
}

func (s *Store) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *Store) getCachedKeyExists(key string) (bool, bool) {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.keyCache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return false, false
	}
	return entry.exists, true
}

func (s *Store) setCachedKeyExists(key string, exists bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.keyCache[key] = keyCacheEntry{exists: exists, expiresAt: time.Now().Add(s.cacheTTL(exists))}
}

func (s *Store) getCachedResult(key string) (resultCacheEntry, bool) {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.resultCache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return resultCacheEntry{}, false
	}
	return entry, true
}

func (s *Store) setCachedResult(key string, allowed bool, matchedDomain string) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	ttl := s.positiveCacheTTL
	if !allowed {
		ttl = s.negativeCacheTTL
	}
	s.resultCache[key] = resultCacheEntry{
		allowed:       allowed,
		matchedDomain: matchedDomain,
		expiresAt:     time.Now().Add(ttl),
	}
}

func (s *Store) pipelineExists(ctx context.Context, keys []string) ([]bool, error) {
	if len(keys) == 0 {
		return nil, nil
	}

	pipe := s.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(keys))
	for i, key := range keys {
		cmds[i] = pipe.Exists(ctx, key)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	results := make([]bool, len(keys))
	for i, cmd := range cmds {
		count, err := cmd.Result()
		if err != nil {
			return nil, err
		}
		results[i] = count > 0
	}
	return results, nil
}

// AuthorizeDomain checks sessions:{userSessionID}:{domain} key existence for host suffixes.
// The key value is not validated; any password in Proxy-Authorization is ignored.
func (s *Store) AuthorizeDomain(ctx context.Context, userSessionID, requestedHost string) (matchedDomain string, err error) {
	host := domain.NormalizeHost(requestedHost)
	if host == "" {
		return "", ErrDomainNotAllowed
	}

	resultKey := s.authorizeCacheKey(userSessionID, host)
	if cached, ok := s.getCachedResult(resultKey); ok {
		if cached.allowed {
			return cached.matchedDomain, nil
		}
		return "", ErrDomainNotAllowed
	}

	candidates := domain.HostSuffixCandidates(requestedHost)
	if len(candidates) == 0 {
		s.setCachedResult(resultKey, false, "")
		return "", ErrDomainNotAllowed
	}

	valkeyKeys := make([]string, len(candidates))
	for i, candidate := range candidates {
		valkeyKeys[i] = s.domainKey(userSessionID, candidate)
	}

	exists := make([]*bool, len(candidates))
	uncachedIdx := make([]int, 0, len(candidates))
	uncachedKeys := make([]string, 0, len(candidates))

	for i, key := range valkeyKeys {
		if value, ok := s.getCachedKeyExists(key); ok {
			v := value
			exists[i] = &v
			continue
		}
		uncachedIdx = append(uncachedIdx, i)
		uncachedKeys = append(uncachedKeys, key)
	}

	if len(uncachedKeys) > 0 {
		pipelineResults, lookupErr := s.pipelineExists(ctx, uncachedKeys)
		if lookupErr != nil {
			return "", lookupErr
		}
		for j, idx := range uncachedIdx {
			value := pipelineResults[j]
			exists[idx] = &value
			s.setCachedKeyExists(valkeyKeys[idx], value)
		}
	}

	for i, candidate := range candidates {
		if exists[i] != nil && *exists[i] {
			s.setCachedResult(resultKey, true, candidate)
			return candidate, nil
		}
	}

	s.setCachedResult(resultKey, false, "")
	return "", ErrDomainNotAllowed
}

// ListUserDomains returns domain suffixes from keys matching sessions:{userSessionID}:*.
func (s *Store) ListUserDomains(ctx context.Context, userSessionID string) ([]string, error) {
	pattern := s.prefix + ":" + userSessionID + ":*"
	prefixLen := len(s.prefix+":"+userSessionID) + 1

	var domains []string
	iter := s.client.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		if len(key) <= prefixLen {
			continue
		}
		domains = append(domains, key[prefixLen:])
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	return domains, nil
}
