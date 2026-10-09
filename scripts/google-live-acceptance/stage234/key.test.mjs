import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import {
  assertKeyRuntime,
  keyRequest,
  validateKeyRequest,
  claimKeyCreate,
} from "./key-guard.mjs";
const env = {
  STAGE234_KEY_ISSUANCE_AUTHORIZED: "true",
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "4378327049",
  PROVIDER_GOOGLE_API_VERSION: "v24",
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
  V2_PREVIEW_ONLY: "true",
  V2_CONFIRMED_WRITE_ENABLED: "false",
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  ACCEPTANCE_PASSWORD: "synthetic-test-password",
};
const authority = {
  workspace_id: "11111111-1111-4111-8111-111111111111",
  account_id: "22222222-2222-4222-8222-222222222222",
  customer_id: "8590146099",
  owner_confirmed: true,
  name: "HM_TEST_STAGE234_20261009T130000Z",
};
const headers = {
  origin: "http://localhost:4402",
  cookie: "hm_v2_session=synthetic; hm_v2_csrf=synthetic",
  "x-csrf-token": "synthetic",
};
const url = `http://127.0.0.1:4000/api/v1/workspaces/${authority.workspace_id}/service-tokens`;
test("one TEST static key 24h via exact stock admin route + human auth/CSRF", () => {
  const body = keyRequest(authority);
  assert.deepEqual(body.scopes, ["adforge:mcp:read", "adforge:mcp:write"]);
  assert.equal(body.expiresInDays, 1);
  assert.equal(
    validateKeyRequest(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      { env, authority },
    ),
    "key_create",
  );
  for (const patch of [
    { expiresInDays: 2 },
    { accountIds: [] },
    { resourceAccessMode: "ALL_CONNECTED" },
    { scopes: ["adforge:mcp:admin"] },
  ])
    assert.throws(() =>
      validateKeyRequest(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, ...patch }),
        },
        { env, authority },
      ),
    );
  for (const bad of [
    {},
    { ...headers, authorization: "Bearer synthetic" },
    { ...headers, origin: "https://outside.invalid" },
    { ...headers, "x-csrf-token": "wrong" },
  ])
    assert.throws(() =>
      validateKeyRequest(
        url,
        { method: "POST", headers: bad, body: JSON.stringify(body) },
        { env, authority },
      ),
    );
});
test("all provider/OAuth/prod/approval/commit and flags bypass denied", () => {
  for (const u of [
    "https://googleads.googleapis.com/v24/customers/8590146099/adGroups:mutate",
    "https://oauth2.googleapis.com/token",
    "http://127.0.0.1:4401/mcp",
    "http://127.0.0.1:4000/mcp/public",
    "http://127.0.0.1:4000/api/v1/mcp/public/approval",
  ])
    assert.throws(() =>
      validateKeyRequest(u, { method: "POST", body: "{}" }, { env, authority }),
    );
  assert.throws(() =>
    assertKeyRuntime({ ...env, STAGE234_KEY_ISSUANCE_AUTHORIZED: "false" }),
  );
  assert.throws(() =>
    assertKeyRuntime({
      ...env,
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099,4378327049",
    }),
  );
  assert.throws(() =>
    assertKeyRuntime({ ...env, PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true" }),
  );
});
test("durable once claim rejects replay and provisioning source never inserts DB or prints secret", () => {
  const root = mkdtempSync(join(tmpdir(), "hm-key-claim-"));
  claimKeyCreate(root);
  assert.throws(() => claimKeyCreate(root), /second_key/);
  const s = readFileSync(
    new URL("./provision-key.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    s,
    /db\.client\.[A-Za-z]+\.(create|update|upsert|delete)/,
  );
  assert.match(s, /sealAcceptanceContext/);
  assert.doesNotMatch(s, /JSON\.stringify\(issued\)/);
  assert.doesNotMatch(s, /approve|commit_preview/);
});
