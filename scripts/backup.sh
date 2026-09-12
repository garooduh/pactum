#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir="${1:-backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$backup_dir"
# Stop writers while capturing both DB and files. The gateway shows temporary unavailability.
docker compose stop api
trap 'docker compose start api >/dev/null' EXIT
docker compose exec -T db pg_dump -U pact -d pact -Fc > "$backup_dir/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar api -C /data -czf - . > "$backup_dir/documents.tar.gz"
cp templates/manifest.json "$backup_dir/template-manifest.json"
sha256sum "$backup_dir/database.dump" "$backup_dir/documents.tar.gz" > "$backup_dir/SHA256SUMS"
printf 'Резервная копия: %s\n' "$backup_dir"
