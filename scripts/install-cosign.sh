#!/usr/bin/env bash
set -Eeuo pipefail
# Identical, pinned verifier on GitHub and the production host. Linux amd64 only.
[[ $(uname -m) == x86_64 ]] || { echo 'Linux amd64 is required.' >&2; exit 2; }
destination=${1:-/usr/local/bin/cosign}
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
python3 - "$temporary/cosign" <<'PY'
import hashlib, sys, time, urllib.error, urllib.request
from pathlib import Path
# Use the official asset API: the browser download URL can have stale CDN redirects.
url = 'https://api.github.com/repos/sigstore/cosign/releases/assets/660069428'
request = urllib.request.Request(url, headers={'Accept': 'application/octet-stream', 'User-Agent': 'pact-bootstrap'})
for attempt in range(4):
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        break
    except (urllib.error.URLError, TimeoutError):
        if attempt == 3:
            raise
        time.sleep(2 ** attempt)
assert hashlib.sha256(data).hexdigest() == '424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa', 'Cosign checksum mismatch'
Path(sys.argv[1]).write_bytes(data)
PY
install -m 755 "$temporary/cosign" "$destination"
