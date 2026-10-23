#!/usr/bin/env bash
# Disposable Linux/Docker test; never run with production keys or on the VPS.
set -Eeuo pipefail
[[ $# -eq 1 ]] || { echo 'usage: test-oidc-file-mount.sh TEST_API_IMAGE' >&2; exit 2; }
image=$1
dir=$(mktemp -d)
name="holypilot-oidc-mount-test-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf -- "$dir"
}
trap cleanup EXIT
chmod 700 "$dir"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$dir/first.pem" 2>/dev/null
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$dir/second.pem" 2>/dev/null
python3 - "$dir" <<'PY'
import base64, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
rows = []
for kid, filename in [('test-first-key', 'first.pem'), ('test-second-key', 'second.pem')]:
    rows.append({'kid': kid, 'privateKeyPemBase64': base64.b64encode((root / filename).read_bytes()).decode()})
(root / 'signing-keys.json').write_text(json.dumps(rows), encoding='utf8')
PY
rm -f "$dir/first.pem" "$dir/second.pem"
chown 1000:0 "$dir/signing-keys.json"
chmod 400 "$dir/signing-keys.json"
[[ $(stat -c '%u:%a' "$dir/signing-keys.json") == 1000:400 ]]
[[ $(stat -c '%u:%a' "$dir") == 0:700 ]]

target=/run/holymedia/oidc/signing-keys.json
node_test='const c=require("node:crypto"); const m=require("./apps/api/dist/mcp/oidc-identity.js"); m.assertOidcStartupReady(); const token=m.signIdToken({issuer:"https://example.invalid",subject:"synthetic",audience:"test-client",nonce:"test-nonce",email:"synthetic@example.invalid",emailVerified:false}); const parts=token.split("."); const head=JSON.parse(Buffer.from(parts[0],"base64url")); const keys=m.oidcJwks().keys; const pub=keys.find(k=>k.kid===head.kid); if(keys.length!==2||!pub||keys.some(k=>"d" in k)||!c.verify("RSA-SHA256",Buffer.from(parts[0]+"."+parts[1]),c.createPublicKey({key:pub,format:"jwk"}),Buffer.from(parts[2],"base64url"))) process.exit(1); console.log("SIGN_AND_JWKS_PASS");'
docker create --name "$name" --user node \
  --mount "type=bind,source=$dir/signing-keys.json,target=$target,readonly" \
  -e "HOLYMEDIA_OIDC_SIGNING_KEYS_FILE=$target" \
  -e HOLYMEDIA_OIDC_ACTIVE_KID=test-second-key \
  "$image" node -e "$node_test" >/dev/null
[[ $(docker inspect -f '{{.Config.User}}' "$name") == node ]]
[[ $(docker inspect -f '{{(index .Mounts 0).RW}}' "$name") == false ]]
! docker inspect "$name" | grep -q 'BEGIN PRIVATE KEY'
! docker image inspect "$image" | grep -q 'BEGIN PRIVATE KEY'
docker start -a "$name"
[[ $(docker inspect -f '{{.State.ExitCode}}' "$name") == 0 ]]
docker rm "$name" >/dev/null

chmod 000 "$dir/signing-keys.json"
if docker run --rm --user node \
  --mount "type=bind,source=$dir/signing-keys.json,target=$target,readonly" \
  -e "HOLYMEDIA_OIDC_SIGNING_KEYS_FILE=$target" \
  -e HOLYMEDIA_OIDC_ACTIVE_KID=test-first-key \
  "$image" node -e "$node_test" >/dev/null 2>&1; then
  echo 'Unreadable key unexpectedly permitted startup' >&2
  exit 1
fi
echo 'UNREADABLE_KEY_FAIL_CLOSED_PASS'
