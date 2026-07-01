package session

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go-proxy/internal/config"
)

type Session struct {
	Domain    string                 `json:"domain"`
	CreatedAt string                 `json:"createdAt"`
	Metadata  map[string]interface{} `json:"metadata"`
}

type Store struct {
	client         *redis.Client
	mode           string
	cache          map[string]cacheEntry
	cacheMu        sync.RWMutex
	cacheTTL       time.Duration
}

type cacheEntry struct {
	session   Session
	expiresAt time.Time
}

func NewStore(valkey config.Valkey) (*Store, error) {
	client, err := NewValkeyClient(valkey)
	if err != nil {
		return nil, err
	}
	return &Store{
		client:   client,
		mode:     ConnectionMode(valkey),
		cache:    make(map[string]cacheEntry),
		cacheTTL: 30 * time.Second,
	}, nil
}

func (s *Store) ConnectionMode() string {
	return s.mode
}

func (s *Store) key(id string) string {
	return "session:" + id
}

func (s *Store) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *Store) getCached(id string) (Session, bool) {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.cache[id]
	if !ok || time.Now().After(entry.expiresAt) {
		return Session{}, false
	}
	return entry.session, true
}

func (s *Store) setCache(id string, session Session) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.cache[id] = cacheEntry{session: session, expiresAt: time.Now().Add(s.cacheTTL)}
}

func (s *Store) GetSession(ctx context.Context, id string) (*Session, error) {
	if cached, ok := s.getCached(id); ok {
		return &cached, nil
	}
	raw, err := s.client.Get(ctx, s.key(id)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var session Session
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, fmt.Errorf(
			"invalid session JSON at %q: %w (expected {\"domain\":\"example.com\",\"createdAt\":\"2026-01-01T00:00:00Z\",\"metadata\":{}})",
			s.key(id),
			err,
		)
	}
	s.setCache(id, session)
	return &session, nil
}
