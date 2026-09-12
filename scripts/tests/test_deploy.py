"""Exercise the remote transaction in a temp directory with mocked system services.
No SSH, PostgreSQL, root permissions or real /opt writes are used.
Run: python3 scripts/tests/test_deploy.py
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

REMOTE = Path(__file__).resolve().parents[1] / 'deploy-remote.sh'

class DeployTransaction(unittest.TestCase):
    def run_case(self, fail_health=False, fail_backup=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = root / 'app'
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            base.mkdir()
            (base / 'releases').mkdir()
            (root / 'data/documents').mkdir(parents=True)
            (root / 'data/documents/user.docx').write_bytes(b'user document')
            (root / 'env').touch()
            py = '''#!/usr/bin/env python3
import os, sys
from pathlib import Path
if os.environ.get('FAIL_HEALTH') == '1' and '/releases/' in str(Path(__file__).resolve()) and sys.argv[1:] == ['-']:
    raise SystemExit(1)
'''
            def executable(path, content):
                path.write_text(content)
                path.chmod(0o755)
            for name in ['backend','frontend','templates','scripts','.venv']:
                (base / name).mkdir()
                (base / name / 'old').touch()
            (base / '.venv/bin').mkdir()
            executable(base / '.venv/bin/python', py)
            (base / 'templates/manifest.json').write_text('{}')
            executable(bin_dir / 'systemctl', '''#!/bin/bash
if [[ "$1" == show ]]; then echo inactive; fi
if [[ "$1" == is-active && "$3" == pact-backup.timer ]]; then exit 3; fi
exit 0
''')
            executable(bin_dir / 'runuser', '''#!/bin/bash
[[ "${FAIL_BACKUP:-0}" != 1 ]] || exit 1
printf 'database dump'
''')
            executable(bin_dir / 'sleep', '#!/bin/bash\nexit 0\n')
            # Delegate Python invocations to the current interpreter; emulate venv only.
            python_real = shutil.which('python3')
            executable(bin_dir / 'python3', f'''#!{python_real}
import os, sys
from pathlib import Path
if sys.argv[1:3] == ['-m','venv']:
    b=Path(sys.argv[3])/'bin'; b.mkdir(parents=True)
    (b/'python').write_text({py!r}); (b/'python').chmod(0o755)
    (b/'pip').write_text('#!/bin/bash\\nexit 0\\n'); (b/'pip').chmod(0o755)
else:
    os.execv({python_real!r}, [{python_real!r}, *sys.argv[1:]])
''')
            payload = root / 'payload'
            for name in ['backend','frontend','templates','scripts']:
                (payload / name).mkdir(parents=True)
                (payload / name / 'new').touch()
            (payload / 'backend/requirements.txt').touch()
            release_id = '20260909T120000Z-123456789abc'
            incoming = root / ('pact-deploy-' + release_id)
            incoming.mkdir()
            archive = incoming / 'release.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(payload, arcname='.')
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            script = REMOTE.read_text().replace('$EUID == 0', '1 == 1')
            for old,new in [('/opt/pact',str(base)),('/var/tmp',str(root)),('/etc/pact.env',str(root/'env')),('/run/lock/pact-deploy.lock',str(root/'lock')),('/var/backups/pact',str(root/'backups')),('/var/lib/pact',str(root/'data'))]:
                script = script.replace(old,new)
            runner = incoming / 'remote.sh'
            runner.write_text(script)
            env = {**os.environ, 'PATH': str(bin_dir)+':'+os.environ['PATH'], 'FAIL_HEALTH': str(int(fail_health)), 'FAIL_BACKUP': str(int(fail_backup))}
            result = subprocess.run(['bash',str(runner),str(incoming),release_id,digest,'1'],env=env,capture_output=True,text=True,timeout=30)
            failed = fail_health or fail_backup
            self.assertEqual(result.returncode == 0, not failed, result.stdout+result.stderr)
            for name in ['backend','frontend','templates','scripts']:
                self.assertTrue((base/name/('old' if failed else 'new')).exists(), result.stdout+result.stderr)
            self.assertEqual((root/'data/documents/user.docx').read_bytes(),b'user document')
            if fail_health:
                self.assertIn('Previous application restored.',result.stderr)
            if not fail_backup:
                self.assertTrue((root/'backups'/release_id/'SHA256SUMS').exists())

    def test_success(self): self.run_case()
    def test_health_failure_restores_old_release(self): self.run_case(fail_health=True)
    def test_backup_failure_does_not_switch_code(self): self.run_case(fail_backup=True)

if __name__ == '__main__': unittest.main()
