"""Scan a disposable container export without printing any matched secret bytes."""
import json
import re
import sys
import tarfile

findings = []
file_count = 0
private_key_template_files = 0
private_key_header = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
patterns = [
    # A PEM header alone is also present in TLS libraries and placeholder
    # documentation. Require the matching footer and a real base64-sized body.
    rb"-----BEGIN (?P<private_key_type>(?:RSA |EC |OPENSSH )?PRIVATE KEY)-----(?:\r?\n|\\n)(?:[A-Za-z0-9+/=]|\r|\n|\\n){80,}-----END (?P=private_key_type)-----",
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
            if value_pattern.search(data):
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
result = {"imageSecretScan": "FAIL" if findings else "PASS", "filesScanned": file_count, "incompletePrivateKeyMarkerFiles": private_key_template_files, "findings": findings}
print("IMAGE_SCAN_RESULT " + json.dumps(result))
if findings:
    sys.exit(1)
