package session

import (
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go-proxy/internal/config"
	"go-proxy/internal/valkeytls"
)

type ClientOptions struct {
	PoolSize        int
	MinIdleConns    int
	PoolTimeout     time.Duration
}

func defaultClientOptions(opts ClientOptions) ClientOptions {
	if opts.PoolSize <= 0 {
		opts.PoolSize = 50
	}
	if opts.MinIdleConns <= 0 {
		opts.MinIdleConns = 10
	}
	if opts.PoolTimeout <= 0 {
		opts.PoolTimeout = 2 * time.Second
	}
	return opts
}

func applyPoolOptions(poolSize, minIdle int, poolTimeout time.Duration) (int, int, time.Duration) {
	opts := defaultClientOptions(ClientOptions{
		PoolSize:     poolSize,
		MinIdleConns: minIdle,
		PoolTimeout:  poolTimeout,
	})
	return opts.PoolSize, opts.MinIdleConns, opts.PoolTimeout
}

func NewValkeyClient(valkey config.Valkey, clientOpts ClientOptions) (*redis.Client, error) {
	tlsCfg, err := valkeytls.Build(valkey.TLS)
	if err != nil {
		return nil, err
	}

	poolSize, minIdle, poolTimeout := applyPoolOptions(
		clientOpts.PoolSize,
		clientOpts.MinIdleConns,
		clientOpts.PoolTimeout,
	)

	if valkey.UseSentinel() {
		return redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName:       valkey.Sentinel.MasterName,
			SentinelAddrs:    valkey.Sentinel.Sentinels,
			Password:         valkey.Sentinel.Password,
			SentinelPassword: valkey.Sentinel.SentinelPassword,
			DB:               valkey.Sentinel.DB,
			TLSConfig:        tlsCfg,
			PoolSize:         poolSize,
			MinIdleConns:     minIdle,
			PoolTimeout:      poolTimeout,
		}), nil
	}

	opt, err := redis.ParseURL(valkey.URL)
	if err != nil {
		return nil, fmt.Errorf("parse valkey url: %w", err)
	}
	if tlsCfg != nil {
		opt.TLSConfig = tlsCfg
	}
	opt.PoolSize = poolSize
	opt.MinIdleConns = minIdle
	opt.PoolTimeout = poolTimeout
	return redis.NewClient(opt), nil
}

func ConnectionMode(valkey config.Valkey) string {
	tlsSuffix := ""
	if valkey.TLS.Enabled {
		tlsSuffix = "+tls"
	}
	if valkey.UseSentinel() {
		return "sentinel:" + valkey.Sentinel.MasterName + "@" + strings.Join(valkey.Sentinel.Sentinels, ",") + tlsSuffix
	}
	return "direct:" + valkey.URL + tlsSuffix
}
