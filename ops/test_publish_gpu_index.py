"""Exercise aggregate-only atomic publication without production access."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from publish_gpu_index import REMOTE_WRITER


class PublicationTests(unittest.TestCase):
    def test_atomic_feed_retains_previous_bytes_on_validation_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'index.html').write_text('admitted page')
            feed = root / 'gpu-index.json'
            feed.write_bytes(b'previous')
            writer = REMOTE_WRITER.replace('/srv/leandata-servarica-production/s4-direct-20261003-v1/edge/portal/public/alternative-data', temporary)
            for invalid in [{'schema_version': 1, 'captures': []},
                            {'schema_version': 1, 'captures': [{}], 'warnings': ['bad']}]:
                result = subprocess.run([sys.executable, '-c', writer], input=json.dumps(invalid).encode(), capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(feed.read_bytes(), b'previous')
            payload = json.dumps({'schema_version': 1, 'captures': [{}], 'warnings': []}).encode()
            result = subprocess.run([sys.executable, '-c', writer], input=payload, capture_output=True, check=True)
            self.assertEqual(result.stdout.decode().strip(), hashlib.sha256(payload).hexdigest())
            self.assertEqual(feed.read_bytes(), payload)
            self.assertEqual(list(root.glob('.gpu-index-*')), [])


if __name__ == '__main__':
    unittest.main()
