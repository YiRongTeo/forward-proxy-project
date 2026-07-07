# RHEL systemd deployment

Run the Go forward proxy as a systemd service on RHEL 8/9 (or compatible distros).

## Valkey key schema

Each domain entitlement is one key; the value is ignored (use a placeholder):

```bash
valkey-cli SET 'sessions:alice:google.com' '1' EX 3600
valkey-cli SET 'sessions:alice:example.com' '1' EX 3600
```

Users authenticate with `Proxy-Authorization: Basic {user}:{password}`. The username selects which keys to check; the password is not validated against Valkey. Missing credentials return **407**.

Seed from the repo:

```bash
./benchmarks/seed-one.sh alice google.com s3cret /etc/go-proxy/config.json
```

## Build and install

```bash
cd go-proxy
make build
sudo make install
```

Edit `/etc/go-proxy/config.json`:

```json
{
  "valkeySessionsPrefix": "sessions",
  "requireProxyAuth": true
}
```

## Service management

```bash
sudo systemctl enable --now go-proxy.service
sudo journalctl -u go-proxy -f
```

## Logs

| Field | Meaning |
|-------|---------|
| `authMode: "credential"` | Proxy-Authorization validated against domain key |
| `authMode: "public"` | Host in `publicDomains` |
| `matchedDomainKey` | Valkey domain suffix that matched |
| `domain_not_allowed` | No matching domain key |
| `missing_credentials` | No `Proxy-Authorization` header (407) |

## Verify

```bash
curl -v -x http://127.0.0.1:8081 -U 'alice:s3cret' https://google.com -o /dev/null
curl -s http://127.0.0.1:9001/sessions/alice | jq .
```

## Upgrade

```bash
cd go-proxy && make build
sudo systemctl stop go-proxy
sudo make install-bin
sudo systemctl start go-proxy
```
