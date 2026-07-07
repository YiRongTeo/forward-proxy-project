package domain

import (
	"reflect"
	"testing"
)

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

func TestHostSuffixCandidates(t *testing.T) {
	got := HostSuffixCandidates("www.google.com")
	want := []string{"www.google.com", "google.com", "com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("HostSuffixCandidates = %v, want %v", got, want)
	}
}
