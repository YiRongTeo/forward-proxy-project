package session

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"go-proxy/internal/config"
)

func TestAuthorizeDomainKey(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:google.com", "s3cret")

	store, err := NewStore(configValkey(mr.Addr()), "sessions")
	if err != nil {
		t.Fatal(err)
	}

	matched, err := store.AuthorizeDomainKey(context.Background(), "alice", "s3cret", "www.google.com")
	if err != nil {
		t.Fatalf("AuthorizeDomainKey: %v", err)
	}
	if matched != "google.com" {
		t.Fatalf("matched = %q, want google.com", matched)
	}
}

func TestAuthorizeDomainKeyWrongPassword(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	mr.Set("sessions:alice:google.com", "s3cret")

	store, err := NewStore(configValkey(mr.Addr()), "sessions")
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.AuthorizeDomainKey(context.Background(), "alice", "wrong", "google.com")
	if err != ErrInvalidCredentials {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestAuthorizeDomainKeyMissingKey(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	store, err := NewStore(configValkey(mr.Addr()), "sessions")
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.AuthorizeDomainKey(context.Background(), "alice", "s3cret", "facebook.com")
	if err != ErrDomainNotAllowed {
		t.Fatalf("expected ErrDomainNotAllowed, got %v", err)
	}
}

func configValkey(addr string) config.Valkey {
	return config.Valkey{URL: "redis://" + addr}
}
