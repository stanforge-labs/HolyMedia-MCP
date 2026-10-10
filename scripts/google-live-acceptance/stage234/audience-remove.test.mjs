import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  restoreTool,
  assertRemovePlan,
  classifyRemoveRequest,
  sourceHead,
  imageDigest,
  target,
  removeQueries,
} from "./audience-remove-guard.mjs";
const origin = () => ({
  result: "I_ADD_VERIFIED_REMOVE_PENDING",
  source_head: sourceHead,
  image_digest: imageDigest,
  journal: { result: "VERIFIED" },
  real_provider_write_call_count: 0,
  commit_id: "hmc_" + "a".repeat(43),
  created_audience: {
    criterion_id: "51668099935",
    resource_name: `customers/${target.customer}/adGroupCriteria/${target.group}~51668099935`,
    audience_resource: `customers/${target.customer}/userInterests/90100`,
    status: "ENABLED",
    mode: "OBSERVATION",
  },
});
const plan = () => {
  const o = origin();
  return {
    version: 3,
    account_id: target.customer,
    atomic: false,
    irreversible: true,
    items: [{}],
    intent: restoreTool(o).arguments,
    checks: removeQueries.slice(1).map((query) => ({ query, rows: [] })),
    operations: [
      {
        kind: "adGroupCriteria",
        method: "remove",
        resource_name: o.created_audience.resource_name,
        fields: {},
        before: {
          resourceName: o.created_audience.resource_name,
          adGroup: target.groupResource,
          status: "ENABLED",
          type: "USER_INTEREST",
          negative: false,
          userInterest: {
            userInterestCategory: o.created_audience.audience_resource,
          },
        },
      },
    ],
  };
};
test("I removal preview bound to one verified created audience; OBS parent never cleared", () => {
  const o = origin(),
    p = plan();
  assert.equal(
    assertRemovePlan(p, o).mutateOperations[0].adGroupCriterionOperation.remove,
    o.created_audience.resource_name,
  );
  for (const edit of [
    (p) => p.operations.push(p.operations[0]),
    (p) => (p.operations[0].resource_name = "foreign"),
    (p) => (p.operations[0].before.type = "KEYWORD"),
    (p) => (p.operations[0].method = "update"),
    (p) => (p.operations[0].fields = { status: "PAUSED" }),
    (p) => (p.atomic = true),
    (p) => (p.intent.items[0].criterion_id = "11743561"),
  ]) {
    const p = plan();
    edit(p);
    assert.throws(() => assertRemovePlan(p, o));
  }
  for (const edit of [
    (o) => (o.journal.result = "BLOCKED"),
    (o) => (o.created_audience.mode = "TARGETING"),
    (o) => (o.created_audience.resource_name = "foreign"),
  ]) {
    const o = origin();
    edit(o);
    assert.throws(() => restoreTool(o));
  }
});
test("I removal transport cannot commit, approve, really mutate or target another account", () => {
  const env = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    STAGE234_SOURCE_HEAD: sourceHead,
    STAGE234_IMAGE_DIGEST: imageDigest,
    STAGE234_I_ORIGIN_SHA256: "b".repeat(64),
  };
  const options = { env, origin: origin(), plan: plan() },
    url = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`;
  for (const body of [
    { ...assertRemovePlan(options.plan, options.origin), validateOnly: false },
    { ...assertRemovePlan(options.plan, options.origin), mutateOperations: [] },
  ])
    assert.throws(() =>
      classifyRemoveRequest(
        url,
        {
          method: "POST",
          headers: { "login-customer-id": target.mcc },
          body: JSON.stringify(body),
        },
        options,
      ),
    );
  assert.throws(() =>
    classifyRemoveRequest(
      "http://127.0.0.1:4000/mcp",
      {
        method: "POST",
        body: JSON.stringify({
          method: "tools/call",
          params: { name: "commit_preview" },
        }),
      },
      options,
    ),
  );
  assert.throws(() =>
    classifyRemoveRequest(
      url.replace(target.customer, target.mcc),
      {
        method: "POST",
        headers: { "login-customer-id": target.mcc },
        body: JSON.stringify(assertRemovePlan(options.plan, options.origin)),
      },
      options,
    ),
  );
});
test("removal preview is JIT after all checks and contains no commit or self approval", () => {
  const source = readFileSync(
    new URL("./audience-remove-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(!source.includes('"commit_preview"'));
  assert.ok(
    source.indexOf("I_REMOVE_JIT_PREVIEW") >
      source.indexOf("human_session_not_ready"),
  );
  assert.ok(
    source.includes("original_absent_mode_restored:false") ||
      source.includes("original_absent_mode_restored: false"),
  );
});
