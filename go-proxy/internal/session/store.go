package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Session struct {
	Domain    string                 `json:"domain"`
	CreatedAt string                 `json:"createdAt"`
	Metadata  map[string]interface{} `json:"metadata"`
}

type CreatedSession struct {
	ID        string                 `json:"id"`
	Domain    string                 `json:"domain"`
	CreatedAt string                 `json:"createdAt"`
	Metadata  map[string]interface{} `json:"metadata"`
	ExpiresIn int                    `json:"expiresIn"`
}

type Store struct {
	client      *redis.Client
	ttlSeconds  int
	cache       map[string]cacheEntry
	cacheMu     sync.RWMutex
	cacheTTL    time.Duration
}

type cacheEntry struct {
	session   Session
	expiresAt time.Time
}

func NewStore(valkeyURL string, ttlSeconds int) (*Store, error) {
	opt, err := redis.ParseURL(valkeyURL)
	if err != nil {
		return nil, err
	}
	return &Store{
		client:     redis.NewClient(opt),
		ttlSeconds: ttlSeconds,
		cache:      make(map[string]cacheEntry),
		cacheTTL:   30 * time.Second,
	}, nil
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

func (s *Store) invalidateCache(id string) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	delete(s.cache, id)
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
		return nil, err
	}
	s.setCache(id, session)
	return &session, nil
}

type CreateInput struct {
	ID         string
	Domain     string
	TTLSeconds int
	Metadata   map[string]interface{}
}

func (s *Store) CreateSession(ctx context.Context, input CreateInput) (*CreatedSession, error) {
	id := input.ID
	if id == "" {
		var b [16]byte
		if _, err := rand.Read(b[:]); err != nil {
			return nil, err
		}
		id = hex.EncodeToString(b[:])
	}
	domain := strings.ToLower(strings.TrimSpace(input.Domain))
	ttl := input.TTLSeconds
	if ttl <= 0 {
		ttl = s.ttlSeconds
	}
	session := Session{
		Domain:    domain,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Metadata:  input.Metadata,
	}
	if session.Metadata == nil {
		session.Metadata = map[string]interface{}{}
	}
	payload, err := json.Marshal(session)
	if err != nil {
		return nil, err
	}
	if err := s.client.Set(ctx, s.key(id), payload, time.Duration(ttl)*time.Second).Err(); err != nil {
		return nil, err
	}
	s.setCache(id, session)
	return &CreatedSession{
		ID:        id,
		Domain:    session.Domain,
		CreatedAt: session.CreatedAt,
		Metadata:  session.Metadata,
		ExpiresIn: ttl,
	}, nil
}

func (s *Store) RefreshSession(ctx context.Context, id string) error {
	ok, err := s.client.Exists(ctx, s.key(id)).Result()
	if err != nil {
		return err
	}
	if ok == 0 {
		return fmt.Errorf("session not found")
	}
	return s.client.Expire(ctx, s.key(id), time.Duration(s.ttlSeconds)*time.Second).Err()
}

func (s *Store) DeleteSession(ctx context.Context, id string) (bool, error) {
	s.invalidateCache(id)
	n, err := s.client.Del(ctx, s.key(id)).Result()
	return n > 0, err
}
