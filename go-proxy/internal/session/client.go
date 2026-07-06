package session

import (
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
	"go-proxy/internal/config"
	"go-proxy/internal/valkeytls"
)

func NewValkeyClient(valkey config.Valkey) (*redis.Client, error) {
	tlsCfg, err := valkeytls.Build(valkey.TLS)
	if err != nil {
		return nil, err
	}

	if valkey.UseSentinel() {
		return redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName:       valkey.Sentinel.MasterName,
			SentinelAddrs:    valkey.Sentinel.Sentinels,
			Password:         valkey.Sentinel.Password,
			SentinelPassword: valkey.Sentinel.SentinelPassword,
			DB:               valkey.Sentinel.DB,
			TLSConfig:        tlsCfg,
		}), nil
	}

	opt, err := redis.ParseURL(valkey.URL)
	if err != nil {
		return nil, fmt.Errorf("parse valkey url: %w", err)
	}
	if tlsCfg != nil {
		opt.TLSConfig = tlsCfg
	}
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
