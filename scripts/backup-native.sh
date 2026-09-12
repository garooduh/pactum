#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/pact-deploy.lock
flock -n 9 || { echo 'Deployment or backup already running.' >&2; exit 1; }
backup_dir="${1:-/var/backups/pact/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$backup_dir"
systemctl stop pact
trap 'systemctl start pact' EXIT
runuser -u postgres -- pg_dump -Fc pact > "$backup_dir/database.dump"
tar -C /var/lib/pact -czf "$backup_dir/documents.tar.gz" documents
cp /opt/pact/templates/manifest.json "$backup_dir/template-manifest.json"
(cd "$backup_dir" && sha256sum database.dump documents.tar.gz > SHA256SUMS)
printf 'Backup: %s\n' "$backup_dir"
