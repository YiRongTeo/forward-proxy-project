package session

import (
	"context"
	"fmt"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func benchStore(b *testing.B, setup func(*miniredis.Miniredis)) *Store {
	b.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(mr.Close)
	setup(mr)

	store, err := NewStore(configValkey(mr.Addr()), testStoreOptions())
	if err != nil {
		b.Fatal(err)
	}
	return store
}

func BenchmarkAuthorizeDomain_ColdCache_MatchFirstSuffix(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:www.example.com", "1")
	})

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.cacheMu.Lock()
		store.keyCache = make(map[string]keyCacheEntry)
		store.resultCache = make(map[string]resultCacheEntry)
		store.cacheMu.Unlock()

		if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAuthorizeDomain_ColdCache_MatchSecondSuffix(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:example.com", "1")
	})

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.cacheMu.Lock()
		store.keyCache = make(map[string]keyCacheEntry)
		store.resultCache = make(map[string]resultCacheEntry)
		store.cacheMu.Unlock()

		if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAuthorizeDomain_ColdCache_MatchThirdSuffix(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:com", "1")
	})

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.cacheMu.Lock()
		store.keyCache = make(map[string]keyCacheEntry)
		store.resultCache = make(map[string]resultCacheEntry)
		store.cacheMu.Unlock()

		if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAuthorizeDomain_ColdCache_DenyAllSuffixes(b *testing.B) {
	store := benchStore(b, func(_ *miniredis.Miniredis) {})

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.cacheMu.Lock()
		store.keyCache = make(map[string]keyCacheEntry)
		store.resultCache = make(map[string]resultCacheEntry)
		store.cacheMu.Unlock()

		if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err == nil {
			b.Fatal("expected deny")
		}
	}
}

func BenchmarkAuthorizeDomain_WarmCache(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:example.com", "1")
	})

	if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAuthorizeDomain_WarmCache_Parallel(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:example.com", "1")
	})

	if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, err := store.AuthorizeDomain(context.Background(), "alice", "www.example.com"); err != nil {
				b.Fatal(err)
			}
		}
	})
}

func BenchmarkAuthorizeDomain_ColdCache_Parallel(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:example.com", "1")
	})

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			host := fmt.Sprintf("www%d.example.com", i%50)
			i++
			_, _ = store.AuthorizeDomain(context.Background(), "alice", host)
		}
	})
}

func BenchmarkDomainKeyExists_Single(b *testing.B) {
	store := benchStore(b, func(mr *miniredis.Miniredis) {
		mr.Set("sessions:alice:example.com", "1")
	})

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.cacheMu.Lock()
		store.keyCache = make(map[string]keyCacheEntry)
		store.cacheMu.Unlock()
		if _, err := store.AuthorizeDomain(context.Background(), "alice", "example.com"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkExistsSequential_3Keys(b *testing.B) {
	mr, err := miniredis.Run()
	if err != nil {
		b.Fatal(err)
	}
	defer mr.Close()
	mr.Set("sessions:alice:com", "1")

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()
	ctx := context.Background()
	keys := []string{
		"sessions:alice:www.example.com",
		"sessions:alice:example.com",
		"sessions:alice:com",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, key := range keys {
			if n, _ := client.Exists(ctx, key).Result(); n > 0 {
				break
			}
		}
	}
}

func BenchmarkExistsPipeline_3Keys(b *testing.B) {
	mr, err := miniredis.Run()
	if err != nil {
		b.Fatal(err)
	}
	defer mr.Close()
	mr.Set("sessions:alice:com", "1")

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()
	ctx := context.Background()
	keys := []string{
		"sessions:alice:www.example.com",
		"sessions:alice:example.com",
		"sessions:alice:com",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pipe := client.Pipeline()
		cmds := make([]*redis.IntCmd, len(keys))
		for j, key := range keys {
			cmds[j] = pipe.Exists(ctx, key)
		}
		_, _ = pipe.Exec(ctx)
		for _, cmd := range cmds {
			if n, _ := cmd.Result(); n > 0 {
				break
			}
		}
	}
}
