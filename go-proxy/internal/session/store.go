package session

import (
	"context"
	"crypto/subtle"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go-proxy/internal/config"
	"go-proxy/internal/domain"
)

var (
	ErrDomainNotAllowed     = errors.New("domain_not_allowed")
	ErrInvalidCredentials   = errors.New("invalid_credentials")
)

type Store struct {
	client         *redis.Client
	mode           string
	prefix         string
	cache          map[string]valueCacheEntry
	cacheMu        sync.RWMutex
	cacheTTL       time.Duration
}

type valueCacheEntry struct {
	value     string
	found     bool
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
		cache:    make(map[string]valueCacheEntry),
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

func (s *Store) getCachedValue(key string) (string, bool, bool) {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.cache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return "", false, false
	}
	return entry.value, entry.found, true
}

func (s *Store) setCachedValue(key, value string, found bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.cache[key] = valueCacheEntry{value: value, found: found, expiresAt: time.Now().Add(s.cacheTTL)}
}

func (s *Store) lookupDomainValue(ctx context.Context, userSessionID, domain string) (string, bool, error) {
	key := s.domainKey(userSessionID, domain)
	if value, found, ok := s.getCachedValue(key); ok {
		return value, found, nil
	}

	raw, err := s.client.Get(ctx, key).Result()
	if err == redis.Nil {
		s.setCachedValue(key, "", false)
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	s.setCachedValue(key, raw, true)
	return raw, true, nil
}

// AuthorizeDomainKey verifies password against sessions:{userSessionID}:{domain} for host suffixes.
func (s *Store) AuthorizeDomainKey(ctx context.Context, userSessionID, password, requestedHost string) (matchedDomain string, err error) {
	for _, candidate := range domain.HostSuffixCandidates(requestedHost) {
		stored, found, lookupErr := s.lookupDomainValue(ctx, userSessionID, candidate)
		if lookupErr != nil {
			return "", lookupErr
		}
		if !found {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(stored), []byte(password)) == 1 {
			return candidate, nil
		}
		return "", ErrInvalidCredentials
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
