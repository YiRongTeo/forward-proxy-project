package session

import (
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
	"go-proxy/internal/config"
)

func NewValkeyClient(valkey config.Valkey) (*redis.Client, error) {
	if valkey.UseSentinel() {
		return redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName:       valkey.Sentinel.MasterName,
			SentinelAddrs:    valkey.Sentinel.Sentinels,
			Password:         valkey.Sentinel.Password,
			SentinelPassword: valkey.Sentinel.SentinelPassword,
			DB:               valkey.Sentinel.DB,
		}), nil
	}

	opt, err := redis.ParseURL(valkey.URL)
	if err != nil {
		return nil, fmt.Errorf("parse valkey url: %w", err)
	}
	return redis.NewClient(opt), nil
}

func ConnectionMode(valkey config.Valkey) string {
	if valkey.UseSentinel() {
		return "sentinel:" + valkey.Sentinel.MasterName + "@" + strings.Join(valkey.Sentinel.Sentinels, ",")
	}
	return "direct:" + valkey.URL
}
