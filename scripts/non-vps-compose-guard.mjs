import assert from "node:assert/strict";

const input = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (value += chunk));
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
});
const config = JSON.parse(input);
const services = config.services;
assert.deepEqual(Object.keys(services).sort(), [
  "api",
  "postgres",
  "redis",
  "web",
]);

for (const service of Object.values(services)) {
  for (const port of service.ports ?? []) {
    assert.equal(
      port.host_ip,
      "127.0.0.1",
      "local TEST port must bind only loopback",
    );
  }
}

const api = services.api.environment;
const [version, encodedKey] =
  api.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS.split(":");
assert.equal(version, api.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION);
assert.match(
  encodedKey,
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
);
assert.equal(
  Buffer.from(encodedKey, "base64").length,
  32,
  "dummy vault key must be 32 bytes",
);
assert.equal(api.HOLYMEDIA_PUBLIC_BASE_URL, "http://127.0.0.1:13300");
assert.equal(api.CORS_ORIGINS, "http://127.0.0.1:13300");
for (const key of [
  "PROVIDER_GOOGLE_ADS_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED",
  "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
  "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
  "V2_CONFIRMED_WRITE_ENABLED",
  "QRS_TEST_RESTRICTED_AUTH",
]) {
  assert.equal(api[key], "false", `${key} must be OFF in local TEST`);
}
assert.equal(api.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST, "");
assert.equal(api.V2_PREVIEW_ONLY, "true");
assert.equal(services.web.build.args.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED, "false");
assert.equal(services.web.build.args.NEXT_PUBLIC_TEST_RESTRICTED_AUTH, "false");
assert.equal(
  services.web.environment.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_ENABLED,
  "false",
);
console.log("Disposable localhost Compose safety contract PASS");
