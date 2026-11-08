#!/usr/bin/env python3
"""Install only signed main-branch releases; no GitHub credentials are needed."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request

REPOSITORY = 'garooduh/pactum'
IDENTITY = f'https://github.com/{REPOSITORY}/.github/workflows/ci.yml@refs/heads/main'
TAG = re.compile(r'ci-([1-9][0-9]*)-([1-9][0-9]*)-([a-f0-9]{12})\Z')
STATE = Path('/var/lib/pact-deploy')
INCOMING = Path('/var/tmp')
COSIGN = '/usr/local/bin/cosign'


def download(url, target, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'pact-deploy', 'Accept': 'application/vnd.github+json'} if url.startswith('https://api.github.com/') else {'User-Agent': 'pact-deploy'})
    with urllib.request.urlopen(request, timeout=120) as response, target.open('wb') as output:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > limit:
                raise ValueError('Download exceeded size limit')
            output.write(chunk)


def verify(archive, bundle):
    subprocess.run([
        COSIGN, 'verify-blob', str(archive), '--bundle', str(bundle),
        '--certificate-identity', IDENTITY,
        '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
    ], check=True, timeout=180)


def inspect_package(archive, tag):
    """Read metadata only after signature verification; reject unsafe tar members."""
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError('Unexpected release tag')
    with tarfile.open(archive, 'r:gz') as package:
        members = package.getmembers()
        names = set()
        for member in members:
            name = member.name.removeprefix('./')
            if name == '.':
                continue
            path = Path(name)
            if (path.is_absolute() or '..' in path.parts or name in names
                    or not (member.isfile() or member.isdir())
                    or path.parts[0] not in {'backend', 'frontend', 'templates', 'scripts', 'build.json'}):
                raise ValueError(f'Unsafe archive member: {name}')
            names.add(name)
        if sum(member.size for member in members) > 512 * 1024 * 1024:
            raise ValueError('Unpacked release exceeded size limit')
        metadata = json.load(package.extractfile('./build.json'))
        if (not re.fullmatch('[a-f0-9]{40}', metadata['commit'])
                or str(metadata['run_id']) != match[1]
                or str(metadata['run_attempt']) != match[2]
                or metadata['commit'][:12] != match[3]):
            raise ValueError('Signed build metadata does not match release tag')
        installer = package.extractfile('./scripts/deploy-remote.sh').read()
    return metadata, installer


def version(tag):
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError('Unexpected release tag')
    return int(match[1]), int(match[2])


def save_state(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data) + '\n')
    temporary.replace(path)


def update(retry=False, templates_reviewed=False):
    with tempfile.TemporaryDirectory(prefix='pact-release-') as temporary:
        work = Path(temporary)
        try:
            download(f'https://api.github.com/repos/{REPOSITORY}/releases/latest', work / 'latest.json', 1024 * 1024)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                print('No published release yet.', flush=True)
                return
            raise
        release = json.loads((work / 'latest.json').read_text())
        tag = release['tag_name']
        if not TAG.fullmatch(tag) or release['draft'] or release['prerelease']:
            raise ValueError('Latest release is not a production CI release')
        state_file = STATE / 'state.json'
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        if state.get('installed') and version(tag) <= version(state['installed']):
            print('No newer release.', flush=True)
            return
        if state.get('failed') == tag and not retry:
            print(f'Release {tag} previously failed; use --retry after investigation.', flush=True)
            return
        print(f'Checking release {tag}', flush=True)
        base = f'https://github.com/{REPOSITORY}/releases/download/{tag}'
        archive = work / 'release.tar.gz'
        bundle = work / 'release.sigstore.json'
        download(base + '/release.tar.gz', archive, 128 * 1024 * 1024)
        download(base + '/release.sigstore.json', bundle, 1024 * 1024)
        verify(archive, bundle)
        metadata, installer = inspect_package(archive, tag)
        with archive.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        # A fresh directory allows a controlled retry without deleting earlier diagnostics.
        from datetime import datetime, timezone
        release_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + digest[:12]
        incoming = INCOMING / ('pact-deploy-' + release_id)
        incoming.mkdir(mode=0o700)
        (incoming / 'release.tar.gz').write_bytes(archive.read_bytes())
        (incoming / 'remote.sh').write_bytes(installer)
        state['failed'] = tag
        save_state(state_file, state)
        subprocess.run([
            'systemd-run', '--unit=pact-deploy-' + release_id, '--wait', '--pipe', '--collect',
            '/bin/bash', str(incoming / 'remote.sh'), str(incoming), release_id, digest,
            str(int(templates_reviewed)),
        ], check=True)
        save_state(state_file, {'installed': tag, 'commit': metadata['commit']})
        print(f'Installed {tag} ({metadata["commit"]})', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retry', action='store_true', help='Retry the latest failed release after investigation')
    parser.add_argument('--templates-reviewed', action='store_true', help='Confirm visual review of changed templates for this invocation')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run as root')
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'update.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another release check is running.', flush=True)
            return
        update(args.retry, args.templates_reviewed)


if __name__ == '__main__':
    main()
