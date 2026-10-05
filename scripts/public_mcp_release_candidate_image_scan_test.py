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
        for content in [b"EACCES" + b"_" + b"CONFIGURATION_REQUIRED_ERROR", b'"AAAAEAA' + b"a" * 100 + b'AAAA"', b'"EAA' + b"a" * 500 + b'"']:
            self.assertEqual(self.scan("workspace/runtime.wasm-base64.js", content).returncode, 0)

    def test_complete_private_key_blocks_rejected_in_text_and_binary(self):
        for key_type in [b"PRIVATE KEY", b"RSA PRIVATE KEY", b"EC PRIVATE KEY", b"OPENSSH PRIVATE KEY"]:
            for newline in [b"\n", b"\\n"]:
                content = b"-----BEGIN " + key_type + b"-----" + newline + b"A" * 128 + newline + b"-----END " + key_type + b"-----"
                for path in ["workspace/config.js", "usr/lib/sample.so"]:
                    result = self.scan(path, content)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertNotIn(content, result.stdout)

    def test_tls_constant_and_documentation_placeholder_not_private_keys(self):
        header = b"-----BEGIN " + b"RSA PRIVATE KEY" + b"-----"
        for content in [header + b"\0", header + b"\nKh9NV...\n" + b"-----END " + b"RSA PRIVATE KEY" + b"-----"]:
            result = self.scan("usr/lib/fixture.so", content)
            self.assertEqual(result.returncode, 0)
            self.assertIn(b'"incompletePrivateKeyMarkerFiles": 1', result.stdout)


if __name__ == "__main__":
    unittest.main()
