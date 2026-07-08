package session

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"go-proxy/internal/config"
)

func testStoreOptions() StoreOptions {
	return StoreOptions{
		SessionsPrefix:   "sessions",
		PositiveCacheTTL: 30 * time.Second,
		NegativeCacheTTL: 5 * time.Second,
	}
}

func TestAuthorizeDomain(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:google.com", "1")

	store, err := NewStore(configValkey(mr.Addr()), testStoreOptions())
	if err != nil {
		t.Fatal(err)
	}

	matched, err := store.AuthorizeDomain(context.Background(), "alice", "www.google.com")
	if err != nil {
		t.Fatalf("AuthorizeDomain: %v", err)
	}
	if matched != "google.com" {
		t.Fatalf("matched = %q, want google.com", matched)
	}
}

func TestAuthorizeDomainAnyPasswordIgnored(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:google.com", "placeholder")

	store, err := NewStore(configValkey(mr.Addr()), testStoreOptions())
	if err != nil {
		t.Fatal(err)
	}

	matched, err := store.AuthorizeDomain(context.Background(), "alice", "google.com")
	if err != nil {
		t.Fatalf("AuthorizeDomain should succeed when key exists regardless of password: %v", err)
	}
	if matched != "google.com" {
		t.Fatalf("matched = %q, want google.com", matched)
	}
}

func TestAuthorizeDomainMissingKey(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	store, err := NewStore(configValkey(mr.Addr()), testStoreOptions())
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.AuthorizeDomain(context.Background(), "alice", "facebook.com")
	if err != ErrDomainNotAllowed {
		t.Fatalf("expected ErrDomainNotAllowed, got %v", err)
	}
}

func TestAuthorizeDomainResultCacheHit(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:example.com", "1")

	store, err := NewStore(configValkey(mr.Addr()), testStoreOptions())
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
		t.Fatalf("first authorize: %v", err)
	}

	mr.Del("sessions:alice:example.com")

	matched, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com")
	if err != nil {
		t.Fatalf("expected cached allow, got %v", err)
	}
	if matched != "example.com" {
		t.Fatalf("matched = %q, want example.com", matched)
	}
}

func TestAuthorizeDomainPipelinesUncachedSuffixes(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:com", "1")

	store, err := NewStore(configValkey(mr.Addr()), testStoreOptions())
	if err != nil {
		t.Fatal(err)
	}

	matched, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com")
	if err != nil {
		t.Fatalf("AuthorizeDomain: %v", err)
	}
	if matched != "com" {
		t.Fatalf("matched = %q, want com", matched)
	}
}

func configValkey(addr string) config.Valkey {
	return config.Valkey{URL: "redis://" + addr}
}
