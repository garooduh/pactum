#!/usr/bin/env bash
# Called only by deploy.sh; targets the existing native /opt/pact installation.
set -Eeuo pipefail
umask 077
[[ $# == 4 && $EUID == 0 ]] || { echo 'Requires root and four deploy arguments.' >&2; exit 2; }
incoming=$1
release_id=$2
expected_hash=$3
reviewed=$4
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$ && "$incoming" == "/var/tmp/pact-deploy-$release_id" && "$expected_hash" =~ ^[a-f0-9]{64}$ && "$reviewed" =~ ^[01]$ ]] || exit 2
base=/opt/pact
release="$base/releases/$release_id"
rollback="$base/releases/$release_id.previous"
backup="/var/backups/pact/$release_id"
exec 9>/run/lock/pact-deploy.lock
flock -n 9 || { echo 'Another deployment or backup is running.' >&2; exit 1; }
[[ -d "$base/backend" && -f /etc/pact.env ]] || { echo 'Existing Pact installation is required.' >&2; exit 1; }
systemctl is-active --quiet pact || { echo 'Pact is not healthy before deployment; aborting.' >&2; exit 1; }
(cd "$incoming" && printf '%s  release.tar.gz\n' "$expected_hash" | sha256sum -c -)
mkdir "$release" "$rollback"
tar -xzf "$incoming/release.tar.gz" --no-same-owner -C "$release"
# Code/templates must remain readable to the pact and www-data service users.
chmod 755 "$release"
chmod -R a+rX "$release/backend" "$release/frontend" "$release/templates" "$release/scripts"
if [[ "$reviewed" != 1 ]]; then
  python3 - "$base/templates" "$release/templates" <<'PY'
from pathlib import Path
import json, sys
old,new=map(Path,sys.argv[1:]); a=json.loads((old/'manifest.json').read_text()); b=json.loads((new/'manifest.json').read_text())
for kind in ('simple','full'):
    if (old/a[kind]['file']).read_bytes() != (new/b[kind]['file']).read_bytes():
        raise SystemExit('Templates changed. Render/review them, then use --templates-reviewed.')
PY
fi
printf 'Preparing isolated server dependencies…\n'
python3 -m venv "$release/.venv"
"$release/.venv/bin/pip" install --disable-pip-version-check --no-cache-dir -q -r "$release/backend/requirements.txt"
chmod -R a+rX "$release/.venv"
(cd "$release/backend" && "$release/.venv/bin/python" -c 'from app.main import create_app; create_app')
# No automatic DB schema migrations: rollback restores code, never user data.
paths=(backend frontend templates scripts .venv)
for name in "${paths[@]}"; do [[ -e "$base/$name" ]] || { echo "Missing $base/$name" >&2; exit 1; }; done
switched=()
stopped=0
committed=0
timer_was_active=0
finish() {
  status=$?
  trap - EXIT
  set +e
  if (( ! committed && stopped )); then
    echo 'Update failed; restoring previous application…' >&2
    systemctl stop pact
    for ((i=${#switched[@]}-1; i>=0; i--)); do
      name=${switched[i]}
      # Remove only our own new link; never recursively remove the old installation.
      if [[ -L "$base/$name" && "$(readlink "$base/$name")" == "$release/$name" ]]; then rm -- "$base/$name"; fi
      mv -T -- "$rollback/$name" "$base/$name" || echo "RESTORE FAILED: $name" >&2
    done
    systemctl start pact
    if health; then echo 'Previous application restored.' >&2; else echo 'ROLLBACK HEALTH CHECK FAILED. Inspect systemctl status pact.' >&2; fi
  fi
  (( ! timer_was_active )) || systemctl start pact-backup.timer
  exit "$status"
}
health() {
  for ((attempt=0; attempt<30; attempt++)); do
    if systemctl is-active --quiet pact && "$base/.venv/bin/python" - <<'PY'
import json, re, urllib.request
base='http://127.0.0.1:8080'
assert json.load(urllib.request.urlopen(base+'/api/health',timeout=3))['status']=='ok'
page=urllib.request.urlopen(base+'/',timeout=3).read().decode()
assets=re.findall(r'(?:src|href)="(/assets/[^" ]+)"',page)
assert assets, 'Missing frontend assets'
for asset in assets:
    assert urllib.request.urlopen(base+asset,timeout=3).status==200
PY
    then return 0; fi
    sleep 2
  done
  return 1
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if systemctl is-active --quiet pact-backup.timer; then timer_was_active=1; systemctl stop pact-backup.timer; fi
# Wait for an already-triggered backup to finish before pausing writers.
for ((attempt=0; attempt<60; attempt++)); do
  state="$(systemctl show pact-backup.service -p ActiveState --value)"
  [[ "$state" == active || "$state" == activating || "$state" == deactivating ]] || break
  sleep 2
done
[[ "$state" != active && "$state" != activating && "$state" != deactivating ]] || { echo 'Backup still running; aborting.' >&2; exit 1; }
stopped=1
systemctl stop pact
mkdir -p "$backup"
runuser -u postgres -- pg_dump -Fc pact > "$backup/database.dump"
tar -C /var/lib/pact -czf "$backup/documents.tar.gz" documents
cp "$base/templates/manifest.json" "$backup/template-manifest.json"
(cd "$backup" && sha256sum database.dump documents.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS)
for name in "${paths[@]}"; do
  mv -T -- "$base/$name" "$rollback/$name"
  switched+=("$name")
  ln -s -- "$release/$name" "$base/$name"
done
systemctl start pact
health
committed=1
printf 'Release active: %s\nBackup: %s\nPrevious paths: %s\n' "$release" "$backup" "$rollback"
# Keep old releases and backups for rollback; retention is an explicit admin action.
rm -f -- "$incoming/release.tar.gz" "$incoming/remote.sh"
rmdir -- "$incoming"
