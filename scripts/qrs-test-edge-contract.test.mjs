import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const nginx = read("infra/test-mcp/mcp-test.single-vps.nginx.conf.example");
const compose = read("infra/test-mcp/docker-compose.single-vps.yml");
const dockerfile = read("infra/Dockerfile.v2");
const login = read("apps/web/app/(public)/auth/page.tsx");

test("TEST vhost is additive, exact-path and loopback-only", () => {
  assert.match(nginx, /server_name mcp-test\.holymedia\.kz;/g);
  assert.doesNotMatch(nginx, /server_name\s+mcp\.holymedia\.kz/);
  assert.match(nginx, /location = \/mcp\s*\{/);
  assert.match(nginx, /location = \/oauth\/token\s*\{/);
  assert.match(nginx, /location = \/auth\/google\/start\s*\{/);
  assert.match(nginx, /location = \/auth\/google\/callback\s*\{/);
  assert.doesNotMatch(
    nginx,
    /location\s+(?:=\s+)?\/api\/v1\/auth\/(?:signup|forgot-password)\b/,
  );
  assert.match(nginx, /location = \/api\/v1\/mcp\/public\/approval\s*\{/);
  assert.match(nginx, /location \/ \{ return 404; \}/);
  assert.doesNotMatch(nginx, /location\s+(?:=\s+)?\/mcp\/public\b/);
  assert.doesNotMatch(nginx, /location\s+(?:\^~\s+)?\/api\/?\s*\{/);
  assert.doesNotMatch(
    nginx,
    /proxy_pass\s+http:\/\/(?!127\.0\.0\.1:(?:14404|13300))\S+/,
  );
  assert.doesNotMatch(nginx, /127\.0\.0\.1:(?:14000|13000)\b/);
});

test("TEST compose does not reference production data or enable writes", () => {
  assert.match(compose, /name: holymedia-qrs-test/);
  assert.match(compose, /name: holymedia-google-acceptance_stage234/);
  assert.doesNotMatch(
    compose,
    /holymedia-v2_default|holymedia-v2\/|holymedia-v2:/,
  );
  assert.match(compose, /GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099"/);
  assert.match(compose, /QRS_TEST_RESTRICTED_AUTH: "true"/);
  assert.match(
    compose,
    /QRS_TEST_LOGIN_ENV_FILE:\?separate protected TEST Google Login env file required/,
  );
  for (const gate of [
    "PROVIDER_GOOGLE_ADS_WRITE_ENABLED",
    "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED",
    "PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED",
    "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED",
    "V2_CONFIRMED_WRITE_ENABLED",
    "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
    "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
  ]) {
    assert.match(compose, new RegExp(`${gate}: "false"`));
  }
  assert.match(compose, /127\.0\.0\.1:14404:4000/);
  assert.match(compose, /127\.0\.0\.1:13300:3000/);
  assert.doesNotMatch(compose, /^\s+worker:/m);
});

test("TEST Web build is pinned to TEST origin and exposes only restricted login", () => {
  assert.match(dockerfile, /FROM base AS test-web-runtime/);
  assert.match(
    dockerfile,
    /NEXT_PUBLIC_API_BASE_URL=https:\/\/mcp-test\.holymedia\.kz/,
  );
  assert.match(
    dockerfile,
    /NEXT_PUBLIC_TEST_RESTRICTED_AUTH=\$NEXT_PUBLIC_TEST_RESTRICTED_AUTH/,
  );
  assert.match(compose, /NEXT_PUBLIC_TEST_RESTRICTED_AUTH: "true"/);
  assert.match(
    login,
    /process\.env\.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED !== "false"/,
  );
  assert.match(login, /mode !== "forgot" && googleLoginEnabled/);
});
