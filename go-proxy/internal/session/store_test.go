package session

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"go-proxy/internal/config"
)

func TestAuthorizeDomain(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:google.com", "1")

	store, err := NewStore(configValkey(mr.Addr()), "sessions")
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

	store, err := NewStore(configValkey(mr.Addr()), "sessions")
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

	store, err := NewStore(configValkey(mr.Addr()), "sessions")
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.AuthorizeDomain(context.Background(), "alice", "facebook.com")
	if err != ErrDomainNotAllowed {
		t.Fatalf("expected ErrDomainNotAllowed, got %v", err)
	}
}

func configValkey(addr string) config.Valkey {
	return config.Valkey{URL: "redis://" + addr}
}
