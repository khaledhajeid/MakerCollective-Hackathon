#!/usr/bin/env bash
# Proves the venue allow-list can't be bypassed with forged client-IP headers.
# Simulates a request arriving from a tunnel connector where the attacker pre-filled every
# common client-IP header and the tunnel (Cloudflare/ngrok) appended the true address.
# Requires: `pnpm stack:up` running.
set -euo pipefail
cd "$(dirname "$0")/../.."
REAL=198.51.100.77
HEADERS=(-H 'CF-Connecting-IP: 203.0.113.50' -H 'X-Real-IP: 203.0.113.51' -H 'True-Client-IP: 203.0.113.52'
  -H "X-Forwarded-For: 203.0.113.53, ${REAL}")
# Send from a trusted tunnel address that is free (the running connector's IP is taken).
running=$(docker ps --format '{{.Names}}')
if ! grep -q '^mc2026-cloudflared-1$' <<<"$running"; then HOP=172.28.0.11
elif ! grep -q '^mc2026-ngrok-1$' <<<"$running"; then HOP=172.28.0.12
else echo "SKIP: both tunnel connectors running; stop one to free a trusted address"; exit 2; fi
docker run --rm --network mc2026_backend --ip "$HOP" curlimages/curl:8.11.1 -s -o /dev/null \
  "${HEADERS[@]}" http://caddy/api/healthz
sleep 1
SEEN=$(docker compose --env-file .env -f infra/docker-compose.yml --profile full logs api1 api2 --no-log-prefix 2>/dev/null \
  | grep '"msg":"incoming request"' | grep -v '"ip":"172.28.0.10"\|"ip":"127.0.0.1"' | tail -1 | sed -E 's/.*"ip":"([^"]+)".*/\1/')
if [[ "$SEEN" == "$REAL" ]]; then echo "PASS: API resolved $SEEN (all forged headers ignored)"; else echo "FAIL: API resolved $SEEN, expected $REAL"; exit 1; fi
