"""Store the one-purpose SSH key and pinned VPS host key as Actions secrets.

Requires PyNaCl; never prints credential values. Run once after server bootstrap.
"""

import base64
import json
import pathlib
import subprocess
import sys
import urllib.request

from nacl.public import PublicKey, SealedBox


API = "https://api.github.com/repos/stanforge-labs/HolyMedia-MCP/actions/secrets"


def github_token() -> str:
    result = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        text=True,
        capture_output=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("password="):
            return line.partition("=")[2]
    raise RuntimeError("Git credential manager did not return a token")


def request(url: str, token: str, data: bytes | None = None) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    with urllib.request.urlopen(
        urllib.request.Request(url, data=data, headers=headers, method="PUT" if data is not None else "GET"),
        timeout=15,
    ) as response:
        body = response.read()
        return json.loads(body) if body else {}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: configure-actions-secrets.py PRIVATE_KEY KNOWN_HOSTS")
    private_key = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    host_lines = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").splitlines()
    hosts = [line for line in host_lines if line.startswith("77.240.38.131 ssh-ed25519 ")]
    if len(hosts) != 1:
        raise RuntimeError("Pinned ed25519 host key missing or ambiguous")
    token = github_token()
    key = request(f"{API}/public-key", token)
    box = SealedBox(PublicKey(base64.b64decode(key["key"])))
    for name, value in {
        "PROD_DEPLOY_SSH_KEY": private_key,
        "PROD_DEPLOY_HOST_KEY": hosts[0] + "\n",
    }.items():
        payload = json.dumps(
            {
                "encrypted_value": base64.b64encode(box.encrypt(value.encode("utf-8"))).decode("ascii"),
                "key_id": key["key_id"],
            }
        ).encode("utf-8")
        request(f"{API}/{name}", token, payload)
        print(f"Configured {name}")


if __name__ == "__main__":
    main()
