import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compose = read("infra/docker-compose.v2.staging.yml");
const app = read("deploy/public-mcp-staging/app.env.example");
const web = read("deploy/public-mcp-staging/web.env.example");
const workflow = read(".github/workflows/v2-public-staging-image.yml");
const nginx = read("deploy/public-mcp-staging/nginx.conf.example");

test("staging infrastructure does not reference production storage or publish data ports", () => {
  assert.match(compose, /name: holymedia-public-mcp-staging/);
  assert.doesNotMatch(compose, /\/etc\/holymedia-v2|\/var\/lib\/holymedia-v2/);
  assert.doesNotMatch(compose, /5432:5432|6379:6379/);
  assert.match(compose, /127\.0\.0\.1:14000:4000/);
  assert.match(compose, /127\.0\.0\.1:13000:3000/);
  assert.match(compose, /postgres:18-alpine/);
});

test("staging policy is OFF and credential examples are empty", () => {
  for (const name of [
    "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
    "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
    "V2_CONFIRMED_WRITE_ENABLED",
  ]) {
    assert.match(app, new RegExp(`^${name}=false$`, "m"));
  }
  assert.match(app, /^V2_PREVIEW_ONLY=true$/m);
  for (const name of [
    "SESSION_HASH_SECRET",
    "PROVIDER_CREDENTIAL_ENCRYPTION_KEYS",
    "PROVIDER_GOOGLE_LOGIN_CLIENT_ID",
    "PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET",
  ]) {
    assert.match(app, new RegExp(`^${name}=$`, "m"));
  }
  assert.match(
    web,
    /NEXT_PUBLIC_API_BASE_URL=https:\/\/v2-staging-mcp\.holymedia\.kz/,
  );
  assert.doesNotMatch(
    web,
    /NEXT_PUBLIC_API_BASE_URL=https:\/\/mcp\.holymedia\.kz/,
  );
});

test("image workflow is isolated and pinned to the approved source", () => {
  assert.match(workflow, /ac083f319304fe95272717a96804ce7349d0ccf4/);
  assert.match(workflow, /branches: \[codex\/public-mcp-staging-image\]/);
  assert.match(workflow, /\[build-staging-image\]/);
  assert.doesNotMatch(workflow, /type=raw,value=production|branches: \[main/);
});

test("ingress logs route labels, not raw request data", () => {
  assert.match(nginx, /log_format hm_public_staging_safe/);
  assert.doesNotMatch(
    nginx,
    /\$request_uri|\$args|\$http_authorization|\$http_cookie/,
  );
  assert.match(nginx, /add_header Referrer-Policy no-referrer always/);
  assert.match(nginx, /add_header Cache-Control no-store always/);
  assert.match(
    nginx,
    /add_header X-Robots-Tag 'noindex, nofollow, noarchive' always/,
  );
});
