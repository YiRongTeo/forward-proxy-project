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

type Store struct {
	client   *redis.Client
	mode     string
	prefix   string
	cache    map[string]existsCacheEntry
	cacheMu  sync.RWMutex
	cacheTTL time.Duration
}

type existsCacheEntry struct {
	exists    bool
	expiresAt time.Time
}

func NewStore(valkey config.Valkey, sessionsPrefix string) (*Store, error) {
	client, err := NewValkeyClient(valkey)
	if err != nil {
		return nil, err
	}
	if sessionsPrefix == "" {
		sessionsPrefix = "sessions"
	}
	return &Store{
		client:   client,
		mode:     ConnectionMode(valkey),
		prefix:   sessionsPrefix,
		cache:    make(map[string]existsCacheEntry),
		cacheTTL: 30 * time.Second,
	}, nil
}

func (s *Store) ConnectionMode() string {
	return s.mode
}

func (s *Store) domainKey(userSessionID, domain string) string {
	return s.prefix + ":" + userSessionID + ":" + domain
}

func (s *Store) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *Store) getCachedExists(key string) (bool, bool) {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.cache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return false, false
	}
	return entry.exists, true
}

func (s *Store) setCachedExists(key string, exists bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.cache[key] = existsCacheEntry{exists: exists, expiresAt: time.Now().Add(s.cacheTTL)}
}

func (s *Store) domainKeyExists(ctx context.Context, userSessionID, domain string) (bool, error) {
	key := s.domainKey(userSessionID, domain)
	if exists, ok := s.getCachedExists(key); ok {
		return exists, nil
	}

	count, err := s.client.Exists(ctx, key).Result()
	if err != nil {
		return false, err
	}
	exists := count > 0
	s.setCachedExists(key, exists)
	return exists, nil
}

// AuthorizeDomain checks sessions:{userSessionID}:{domain} key existence for host suffixes.
// The key value is not validated; any password in Proxy-Authorization is ignored.
func (s *Store) AuthorizeDomain(ctx context.Context, userSessionID, requestedHost string) (matchedDomain string, err error) {
	for _, candidate := range domain.HostSuffixCandidates(requestedHost) {
		exists, lookupErr := s.domainKeyExists(ctx, userSessionID, candidate)
		if lookupErr != nil {
			return "", lookupErr
		}
		if exists {
			return candidate, nil
		}
	}
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
