import io
from pathlib import Path
import subprocess
import sys
import tarfile
import unittest


class ImageScanTests(unittest.TestCase):
    def scan(self, name, content):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w") as archive:
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
        return subprocess.run(
            [sys.executable, str(Path(__file__).with_name("public_mcp_release_candidate_image_scan.py"))],
            input=data.getvalue(), capture_output=True,
        )

    def test_clean_application(self):
        self.assertEqual(self.scan("workspace/apps/api/dist/main.js", b"console.log('ready')").returncode, 0)

    def test_environment_and_git_credentials_rejected(self):
        for path in ["workspace/.env", "root/.git-credentials", "root/.ssh/id_ed25519"]:
            self.assertNotEqual(self.scan(path, b"redacted sample").returncode, 0)

    def test_runtime_oauth_fixture_rejected_without_printing_value(self):
        value = b"hm_oauth_" + b"a" * 43
        result = self.scan("workspace/fixture.json", value)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(value, result.stdout)

    def test_delimited_meta_token_rejected_without_printing_value(self):
        value = b"EAA" + b"a" * 100
        result = self.scan("workspace/provider.json", b'{"token":"' + value + b'"}')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(value, result.stdout)

    def test_binary_tables_and_embedded_wasm_are_not_meta_tokens(self):
        for content in [b"EACCES_CONFIGURATION_REQUIRED_ERROR", b'"AAAAEAA' + b"a" * 100 + b'AAAA"', b'"EAA' + b"a" * 500 + b'"']:
            self.assertEqual(self.scan("workspace/runtime.wasm-base64.js", content).returncode, 0)


if __name__ == "__main__":
    unittest.main()
