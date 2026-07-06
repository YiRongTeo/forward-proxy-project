package domain

import "testing"

func TestIsPublicHost(t *testing.T) {
	public := []string{"example.com", "internal.corp"}

	tests := []struct {
		host   string
		public bool
	}{
		{"example.com", true},
		{"www.example.com", true},
		{"api.internal.corp", true},
		{"google.com", false},
		{"", false},
	}

	for _, tc := range tests {
		got := IsPublicHost(tc.host, public)
		if got != tc.public {
			t.Fatalf("IsPublicHost(%q) = %v, want %v", tc.host, got, tc.public)
		}
	}
}

func TestRequestHostAllowed(t *testing.T) {
	defaults := []string{"updates.corp"}

	if !RequestHostAllowed("www.google.com", "google.com", defaults) {
		t.Fatal("expected session domain match")
	}
	if !RequestHostAllowed("pkg.updates.corp", "google.com", defaults) {
		t.Fatal("expected default allowed domain match")
	}
	if RequestHostAllowed("facebook.com", "google.com", defaults) {
		t.Fatal("expected domain mismatch to be denied")
	}
}
