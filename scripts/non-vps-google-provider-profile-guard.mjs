import assert from "node:assert/strict";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
assert.equal(config.name, "holypilot-google-test-local");
assert.deepEqual(Object.keys(config.services).sort(), [
  "api",
  "postgres",
  "redis",
  "web",
]);
for (const service of Object.values(config.services)) {
  for (const port of service.ports ?? []) {
    assert.equal(
      port.host_ip,
      "127.0.0.1",
      "Google TEST profile must bind loopback only",
    );
  }
}
const api = config.services.api.environment;
assert.equal(api.HOLYMEDIA_PUBLIC_BASE_URL, "http://127.0.0.1:23300");
assert.equal(api.CORS_ORIGINS, "http://127.0.0.1:23300");
assert.equal(
  api.PROVIDER_GOOGLE_REDIRECT_URI,
  "http://127.0.0.1:24404/oauth/google/callback",
);
assert.match(api.DATABASE_URL, /@postgres:5432\/holypilot_google_test_local$/);
assert.equal(api.REDIS_URL, "redis://redis:6379");
assert.equal(api.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST, "8590146099");
assert.equal(api.V2_PREVIEW_ONLY, "true");
assert.equal(api.QRS_TEST_RESTRICTED_AUTH, "true");
assert.equal(api.QRS_TEST_LOCAL_READONLY_AUTH, "true");
for (const key of [
  "PROVIDER_GOOGLE_ADS_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED",
  "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
  "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
  "V2_CONFIRMED_WRITE_ENABLED",
  "QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED",
  "QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED",
  "QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED",
  "QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED",
])
  assert.equal(api[key], "false", `${key} must remain OFF`);
assert.equal(
  config.services.web.build.args.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED,
  "false",
);
assert.equal(
  config.services.web.environment.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_ENABLED,
  "false",
);
assert(config.volumes["holypilot-google-test-postgres"]);
assert(config.volumes["holypilot-google-test-redis"]);
console.log("Separate localhost Google TEST profile contract PASS");
