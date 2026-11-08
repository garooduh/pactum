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
# Both official endpoints serve the same pinned binary. Avoid cached stale redirects.
urls = [
    'https://api.github.com/repos/sigstore/cosign/releases/assets/660069428',
    'https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-linux-amd64',
]
for attempt in range(4):
    url = urls[attempt % len(urls)]
    if attempt % len(urls) == 0:
        url += '?pact-bootstrap=' + str(time.time_ns())
    request = urllib.request.Request(url, headers={'Accept': 'application/octet-stream', 'User-Agent': 'pact-bootstrap'})
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
