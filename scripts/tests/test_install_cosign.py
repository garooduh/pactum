"""Verifier bootstrap must never install unchecked content, including on fallback."""
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

CODE = (Path(__file__).resolve().parents[1] / 'install-cosign.sh').read_text().split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]

class CosignBootstrapTests(unittest.TestCase):
    def test_fallback_still_rejects_wrong_checksum(self):
        failure = HTTPError('https://api.github.com', 503, 'unavailable', {}, None)
        with patch('urllib.request.urlopen', side_effect=[failure, io.BytesIO(b'untrusted binary')]) as fetch, patch('time.sleep'), patch.object(sys, 'argv', ['bootstrap', '/tmp/unused-cosign-test']), patch.object(Path, 'write_bytes') as write:
            with self.assertRaisesRegex(AssertionError, 'checksum mismatch'):
                exec(compile(CODE, 'install-cosign', 'exec'), {})
            write.assert_not_called()
            self.assertTrue(fetch.call_args_list[0].args[0].full_url.startswith('https://api.github.com/repos/sigstore/cosign/releases/assets/660069428?'))
            self.assertEqual(fetch.call_args_list[1].args[0].full_url, 'https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-linux-amd64')

    def test_network_failure_exhausts_bounded_retries_without_writing(self):
        failure = HTTPError('https://api.github.com', 503, 'unavailable', {}, None)
        with patch('urllib.request.urlopen', side_effect=failure) as fetch, patch('time.sleep'), patch.object(sys, 'argv', ['bootstrap', '/tmp/unused-cosign-test']), patch.object(Path, 'write_bytes') as write:
            with self.assertRaises(HTTPError):
                exec(compile(CODE, 'install-cosign', 'exec'), {})
            self.assertEqual(fetch.call_count, 4)
            write.assert_not_called()

if __name__ == '__main__':
    unittest.main()
