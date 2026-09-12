#!/usr/bin/env bash
# Deploy the native Debian/LXC installation. No passwords are stored here.
set -Eeuo pipefail

usage() {
  cat <<'HELP'
Usage: scripts/deploy.sh [--check] [--templates-reviewed]
  --check               Test/build/package locally; do not connect to the server.
  --templates-reviewed  Confirm that changed DOCX templates were rendered and reviewed.
Environment:
  DEPLOY_HOST       SSH destination (default root@192.168.1.206); SSH aliases supported
  PYTHON            Optional preconfigured Python; default creates a temporary venv with python3
  NPM               npm executable (default npm)
  DEPLOY_SSH_CONFIG Optional SSH config file (e.g. /dev/null)
  DEPLOY_IDENTITY   Optional SSH private key path
SSH uses keys/agent and BatchMode; passwords are never requested or embedded.
HELP
}
check_only=0
reviewed=0
for option in "$@"; do
  case "$option" in
    --check) check_only=1 ;;
    --templates-reviewed) reviewed=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$option" >&2; usage >&2; exit 2 ;;
  esac
done
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="${PYTHON:-python3}"
npm_bin="${NPM:-npm}"
host="${DEPLOY_HOST:-root@192.168.1.206}"
[[ "$host" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$ ]] || { echo 'Invalid DEPLOY_HOST (use an SSH alias for IPv6).' >&2; exit 2; }
command -v "$python_bin" >/dev/null || { echo 'Install Python 3 with venv support, or set PYTHON.' >&2; exit 2; }
python_bin="$(command -v "$python_bin")"
[[ "$python_bin" = /* ]] || python_bin="$PWD/$python_bin"
command -v "$npm_bin" >/dev/null
work_dir="$(mktemp -d /tmp/pact-deploy.XXXXXXXX)"
trap 'rm -rf -- "$work_dir"' EXIT
stage="$work_dir/release"
mkdir "$stage"
# Freeze one snapshot so edits during a build cannot mix tested and deployed code.
(cd "$root_dir" && tar --exclude=node_modules --exclude=dist --exclude=__pycache__ --exclude=.pytest_cache --exclude='*.pyc' -cf - backend frontend templates scripts) | tar -xf - -C "$stage"
if [[ -z "${PYTHON:-}" ]]; then
  "$python_bin" -m venv "$work_dir/venv"
  python_bin="$work_dir/venv/bin/python"
  "$python_bin" -m pip install --disable-pip-version-check -q -r "$stage/backend/requirements-dev.txt"
fi
export PYTHONDONTWRITEBYTECODE=1
printf 'Checking backend and templates…\n'
(cd "$stage" && PYTHONPATH="$stage/backend${PYTHONPATH:+:$PYTHONPATH}" "$python_bin" -m pytest backend/tests -q)
"$python_bin" "$stage/scripts/tests/test_deploy.py"
"$python_bin" - "$stage/templates" <<'PY'
import json, sys, zipfile
from pathlib import Path
root=Path(sys.argv[1]); manifest=json.loads((root/'manifest.json').read_text())
for kind in ('simple','full'):
    name=manifest[kind]['file']
    assert Path(name).name==name and name.endswith('.docx'), 'Invalid template path'
    with zipfile.ZipFile(root/name) as z:
        assert z.testzip() is None and 'word/document.xml' in z.namelist()
PY
printf 'Installing frontend dependencies and building…\n'
(cd "$stage/frontend" && "$npm_bin" ci --no-audit --no-fund && "$npm_bin" test && "$npm_bin" run build)
# Include only runtime files, not sources of original clients, tests or dependencies.
mkdir -p "$work_dir/payload/backend" "$work_dir/payload/frontend"
cp -a "$stage/backend/app" "$stage/backend/requirements.txt" "$work_dir/payload/backend/"
cp -a "$stage/frontend/dist" "$work_dir/payload/frontend/"
mkdir "$work_dir/payload/templates"
(cd "$stage/templates" && tar --exclude=source -cf - .) | tar -xf - -C "$work_dir/payload/templates"
cp -a "$stage/scripts" "$work_dir/payload/"
cp "$stage/scripts/deploy-remote.sh" "$work_dir/remote.sh"
tar -czf "$work_dir/release.tar.gz" -C "$work_dir/payload" .
archive_hash="$(sha256sum "$work_dir/release.tar.gz" | cut -d' ' -f1)"
runner_hash="$(sha256sum "$work_dir/remote.sh" | cut -d' ' -f1)"
printf 'Checks passed. Package SHA256: %s\n' "$archive_hash"
if (( check_only )); then
  printf 'Check complete; server was not contacted.\n'
  exit 0
fi
ssh_args=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
[[ -z "${DEPLOY_SSH_CONFIG:-}" ]] || ssh_args+=(-F "$DEPLOY_SSH_CONFIG")
[[ -z "${DEPLOY_IDENTITY:-}" ]] || ssh_args+=(-i "$DEPLOY_IDENTITY")
# Require a known host key; do not silently accept a new or changed server identity.
ssh_args+=(-o StrictHostKeyChecking=yes)
release_id="$(date -u +%Y%m%dT%H%M%SZ)-${archive_hash:0:12}"
remote_dir="/var/tmp/pact-deploy-$release_id"
ssh "${ssh_args[@]}" "$host" "umask 077; mkdir '$remote_dir'"
scp "${ssh_args[@]}" "$work_dir/release.tar.gz" "$work_dir/remote.sh" "$host:$remote_dir/"
# Run under systemd: a laptop sleep/network disconnect must not interrupt rollback.
ssh "${ssh_args[@]}" "$host" "cd '$remote_dir' && printf '%s  %s\n' '$runner_hash' remote.sh | sha256sum -c - && systemd-run --unit=pact-deploy-$release_id --wait --pipe --collect /bin/bash '$remote_dir/remote.sh' '$remote_dir' '$release_id' '$archive_hash' '$reviewed'"
printf 'Deployment complete: %s\n' "$release_id"
