"""Scan a disposable container export without printing any matched secret bytes."""
import json
import hashlib
import re
import sys
import tarfile

findings = []
file_count = 0
private_key_template_files = 0
public_selftest_matches = {}
# Published known-answer test vectors, never a blanket library/file exception.
# Derived from the C string literals in this exact upstream release source:
selftest_source = "https://github.com/gnutls/gnutls/blob/3.7.9/lib/crypto-selftests-pk.c"
selftest_path = "usr/lib/x86_64-linux-gnu/libgnutls.so.30.34.3"
selftest_key_hashes = {
    "d039c8119a029ab9f9c83c04d67002d887b6bc6026c4264402ab27cdf24cf138",
    "7c4c63ee462e0e700cd9e29c8e0f730b3f1b484c4abdd83f1e69fcd477c061fa",
    "91ea1699ff6b1a34b4a1d500a9c75a808441e47b9ea68da6fb0195e01ce1dc61",
    "ef237ea8db4f2ae9ee100e8ced96d29b5dceb0e6a948443e6b8a00b1791f9ec9",
    "fa0b06a72461ec0a963dcfccb8d5b61bd88a6074fc7271573bff68ab86b8c1af",
    "a4d138d7ef9748464117b44fb9c0a4b5b85a1599a127d02690abaa96d03c16e6",
}
private_key_header = re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")
patterns = [
    # A PEM header alone is also present in TLS libraries and placeholder
    # documentation. Require the matching footer and a real base64-sized body.
    rb"-----BEGIN (?P<private_key_type>(?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)-----(?:\r?\n|\\n)(?:[A-Za-z0-9+/=]|\r|\n|\\n){32,}-----END (?P=private_key_type)-----",
    rb"sk-proj-[A-Za-z0-9_-]{20,}",
    rb"GOCSPX-[A-Za-z0-9_-]{20,}",
    # Meta access tokens are delimited values, not arbitrary EA substrings in
    # ELF tables, documentation identifiers, or base64-encoded WASM payloads.
    rb"(?<![A-Za-z0-9_+/=-])EA[A-Za-z0-9_-]{80,400}(?![A-Za-z0-9_+/=-])",
    rb"\bhm_oauth_[A-Za-z0-9_-]{30,}\b",
    rb"\bgh[pousr]_[A-Za-z0-9_]{30,}\b",
    rb"\bgithub_pat_[A-Za-z0-9_]{30,}\b",
]
value_pattern = re.compile(b"|".join(patterns))
path_pattern = re.compile(r"(^|/)(\.env(?:\..*)?|\.git|\.git-credentials|id_rsa|id_ed25519|authorized_keys|known_hosts)(/|$)")
with tarfile.open(fileobj=sys.stdin.buffer, mode="r|*") as archive:
    for entry in archive:
        name = entry.name.removeprefix("./")
        if path_pattern.search(name):
            findings.append({"path": name, "reason": "forbidden environment/git/SSH material"})
        if name.startswith(("workspace/apps/", "workspace/packages/")) and "/node_modules/" not in name:
            if re.search(r"\.(?:test|spec)\.", name):
                findings.append({"path": name, "reason": "compiled project test fixture"})
        if not entry.isfile():
            continue
        file_count += 1
        stream = archive.extractfile(entry)
        tail = b""
        found = False
        template_header = False
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            data = tail + chunk
            for match in value_pattern.finditer(data):
                fingerprint = hashlib.sha256(match.group(0)).hexdigest()
                if name == selftest_path and fingerprint in selftest_key_hashes:
                    public_selftest_matches[fingerprint] = {
                        "path": name, "sha256": fingerprint, "publicSource": selftest_source,
                    }
                else:
                    found = True
            if private_key_header.search(data):
                template_header = True
            if name.endswith(".npmrc") and re.search(rb"(?:_authToken|_password|_auth)\s*=\s*[^\s]+", data):
                found = True
            tail = data[-65536:]
        if found:
            findings.append({"path": name, "reason": "secret marker; content redacted"})
        elif template_header:
            private_key_template_files += 1
result = {"imageSecretScan": "FAIL" if findings else "PASS", "filesScanned": file_count, "incompletePrivateKeyMarkerFiles": private_key_template_files, "publishedCryptoSelftestVectors": list(public_selftest_matches.values()), "findings": findings}
print("IMAGE_SCAN_RESULT " + json.dumps(result))
if findings:
    sys.exit(1)
