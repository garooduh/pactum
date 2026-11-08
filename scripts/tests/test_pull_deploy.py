"""Check the production trust boundary without network, root, or system services."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pull_deploy', Path(__file__).resolve().parents[1] / 'pull-deploy.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
COMMIT = 'a' * 40
TAG = 'ci-100-1-' + COMMIT[:12]


def make_package(path, extra=None, metadata=None):
    with tarfile.open(path, 'w:gz') as package:
        for name, data in {
            './build.json': json.dumps(metadata or {'commit': COMMIT, 'run_id': 100, 'run_attempt': 1}).encode(),
            './scripts/deploy-remote.sh': b'#!/bin/bash\nexit 0\n',
        }.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            package.addfile(member, io.BytesIO(data))
        if extra:
            package.addfile(extra)


class PackageSecurity(unittest.TestCase):
    def test_valid_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'package.tar.gz'
            make_package(archive)
            metadata, installer = updater.inspect_package(archive, TAG)
            self.assertEqual(metadata['commit'], COMMIT)
            self.assertTrue(installer.startswith(b'#!/bin/bash'))

    def test_unsafe_members_rejected(self):
        for name, symlink in [('../escape', False), ('/etc/escape', False), ('./backend/link', True), ('./build.json', False), ('./unknown/file', False)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / 'package.tar.gz'
                member = tarfile.TarInfo(name)
                if symlink:
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/etc'
                make_package(archive, extra=member)
                with self.assertRaises(ValueError):
                    updater.inspect_package(archive, TAG)

    def test_release_tag_must_match_signed_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'package.tar.gz'
            make_package(archive)
            for tag in ['ci-101-1-' + COMMIT[:12], 'ci-100-2-' + COMMIT[:12], 'ci-100-1-' + 'b' * 12, 'main']:
                with self.subTest(tag=tag), self.assertRaises(ValueError):
                    updater.inspect_package(archive, tag)

    def test_verifier_requires_exact_workflow_and_issuer(self):
        with patch.object(updater.subprocess, 'run') as run:
            updater.verify(Path('archive'), Path('bundle'))
            command = run.call_args.args[0]
            self.assertIn(updater.IDENTITY, command)
            self.assertIn('https://token.actions.githubusercontent.com', command)
            self.assertTrue(run.call_args.kwargs['check'])
            self.assertNotIn('--insecure-ignore-tlog', command)


class UpdateTransaction(unittest.TestCase):
    def exercise(self, state=None, bad_signature=False, deploy_failure=False, retry=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state_file = root / 'state.json'
            if state:
                state_file.write_text(json.dumps(state))
            downloads = []

            def download(url, target, limit):
                downloads.append(url)
                if target.name == 'latest.json':
                    target.write_text(json.dumps({'tag_name': TAG, 'draft': False, 'prerelease': False, 'assets': [
                        {'name': 'release.tar.gz', 'id': 1},
                        {'name': 'release.sigstore.json', 'id': 2},
                    ]}))
                elif target.name == 'release.tar.gz':
                    make_package(target)
                else:
                    target.write_text('{}')

            with patch.object(updater, 'STATE', root), patch.object(updater, 'INCOMING', root), \
                    patch.object(updater, 'download', side_effect=download), \
                    patch.object(updater, 'verify', side_effect=ValueError('invalid signature') if bad_signature else None) as verify, \
                    patch.object(updater.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'systemd-run') if deploy_failure else None) as run:
                if bad_signature:
                    with self.assertRaises(ValueError):
                        updater.update(retry=retry)
                elif deploy_failure:
                    with self.assertRaises(subprocess.CalledProcessError):
                        updater.update(retry=retry)
                else:
                    updater.update(retry=retry)
                result = json.loads(state_file.read_text()) if state_file.exists() else {}
                return result, verify.call_count, run.call_count, downloads

    def test_success_records_installed_version(self):
        state, verified, deployed, _ = self.exercise()
        self.assertEqual(state, {'installed': TAG, 'commit': COMMIT})
        self.assertEqual((verified, deployed), (1, 1))

    def test_invalid_signature_never_runs_installer(self):
        state, verified, deployed, _ = self.exercise(bad_signature=True)
        self.assertEqual(state, {})
        self.assertEqual((verified, deployed), (1, 0))

    def test_downgrade_and_already_installed_release_are_skipped(self):
        for installed in [TAG, 'ci-101-1-' + COMMIT[:12], 'ci-100-2-' + COMMIT[:12]]:
            with self.subTest(installed=installed):
                _, verified, deployed, downloads = self.exercise({'installed': installed})
                self.assertEqual((verified, deployed, len(downloads)), (0, 0, 1))

    def test_failed_deployment_preserves_previous_installed_version(self):
        previous = 'ci-99-1-' + COMMIT[:12]
        state, _, _, _ = self.exercise({'installed': previous}, deploy_failure=True)
        self.assertEqual(state, {'installed': previous, 'failed': TAG})

    def test_failed_release_requires_explicit_retry(self):
        _, verified, deployed, _ = self.exercise({'failed': TAG})
        self.assertEqual((verified, deployed), (0, 0))
        state, verified, deployed, _ = self.exercise({'failed': TAG}, retry=True)
        self.assertEqual((verified, deployed), (1, 1))
        self.assertEqual(state['installed'], TAG)


if __name__ == '__main__':
    unittest.main()
