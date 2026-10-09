import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
const { structuredClone } = globalThis;
import {
  scenarioTarget as t,
  prepareAcceptanceScenarios,
  classifyBudgetImpact,
  plannedRsaArguments,
} from "./scenario-preparation.mjs";
const evidence = JSON.parse(
  readFileSync(
    new URL(
      "../../../artifacts/google-full-scope/read-only-preflight-20261009.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const now = Date.now(),
  prefix = `customers/${t.customer}`;
const fresh = () => ({
  verified_at: new Date(now).toISOString(),
  source_head: "a".repeat(40),
  customer: { id: t.customer, testAccount: true, currencyCode: "USD" },
  mcc: { id: t.mcc, testAccount: true },
  hierarchy: { id: t.customer, testAccount: true, level: 1 },
  campaign: {
    id: t.campaign,
    resourceName: `${prefix}/campaigns/${t.campaign}`,
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MANUAL_CPC",
    campaignBudget: `${prefix}/campaignBudgets/${t.budget}`,
  },
  adGroup: {
    id: t.group,
    resourceName: `${prefix}/adGroups/${t.group}`,
    status: "PAUSED",
    type: "SEARCH_STANDARD",
    cpcBidMicros: "100000",
  },
});
test("tracked READ observation is historical, no fake fresh or LIVE PASS", () => {
  const plan = prepareAcceptanceScenarios(evidence);
  assert.equal(plan.kind, "LOCAL_PLANNING_NOT_LIVE_ACCEPTANCE");
  assert.equal(
    plan.observation.read_runtime_image_source,
    "7da2fbbe7d150072183bc5e121cae4abae019ddc",
  );
  assert.equal(plan.policy.first_live_jit, "N");
  assert.equal(plan.policy.pending_approvals_max, 1);
  assert.equal(plan.policy.real_provider_calls_in_preparation, 0);
  for (const scenario of Object.values(plan.scenarios)) {
    assert.equal(scenario.live_pass, false);
    assert.equal(scenario.preview_created, false);
    assert.equal(scenario.commit_authorized, false);
    assert.equal(scenario.real_provider_write_calls, 0);
  }
});
test("N exact typed0.11USD group bid, separate stock inverse without invented commitID", () => {
  const N = prepareAcceptanceScenarios(evidence).scenarios.N;
  assert.deepEqual(N.intent, {
    name: "google_ads_bid_budget_preview",
    arguments: {
      provider: "GOOGLE_ADS",
      account_id: t.customer,
      items: [
        {
          field: "ad_group_cpc",
          campaign_id: t.campaign,
          ad_group_id: t.group,
          change: { mode: "absolute", amount: "0.11", currency: "USD" },
        },
      ],
    },
  });
  assert.equal(N.planned_before.cpc_bid_micros, "100000");
  assert.equal(N.planned_after.cpc_bid_micros, "110000");
  assert.equal(N.actual_fresh_bid, null);
  assert.equal(N.restore.tool, "preview_rollback_commit");
  assert.equal(N.restore.new_manual_approval_required, true);
  const proof = fresh();
  proof.adGroup.cpcBidMicros = "110000";
  const drift = prepareAcceptanceScenarios(evidence, {
    freshReadProof: proof,
    now,
  }).scenarios.N;
  assert.equal(drift.status, "BLOCKED_PROVIDER_BID_DRIFT");
  assert.equal(drift.intent, null);
});
test("G baseline inherited keyword/manual strategy stays BLOCKED with no strategy-switch intent", () => {
  const G = prepareAcceptanceScenarios(evidence).scenarios.G;
  assert.equal(G.status, "BLOCKED_NO_ELIGIBLE_AUTOMATED_EXPLICIT_CPC");
  assert.equal(G.planned_before, null);
  assert.deepEqual(
    G.conditional_intent_not_authorized.arguments.items[0].change,
    { mode: "percent", percent: "10", currency: "USD" },
  );
  assert.equal(
    G.conditional_intent_not_authorized.arguments.items[0].field,
    "keyword_cpc",
  );
  assert.equal(G.commit_authorized, false);
});
test("G eligible only with complete owned positive explicit CPC proof plus automatic strategy", () => {
  const proof = fresh();
  proof.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
  proof.keyword = {
    criterionId: t.keyword,
    resourceName: `${prefix}/adGroupCriteria/${t.group}~${t.keyword}`,
    type: "KEYWORD",
    negative: false,
    status: "ENABLED",
    cpcBidMicros: "100000",
    effectiveCpcBidMicros: "100000",
    effectiveCpcBidSource: "AD_GROUP_CRITERION",
  };
  assert.equal(
    prepareAcceptanceScenarios(evidence, { freshReadProof: proof, now })
      .scenarios.G.status,
    "ELIGIBLE_READ_ONLY_PREVIEW_NOT_STARTED",
  );
  for (const change of [
    (p) => (p.keyword.cpcBidMicros = "0"),
    (p) => (p.keyword.effectiveCpcBidSource = "AD_GROUP"),
    (p) => delete p.keyword.cpcBidMicros,
    (p) => (p.campaign.biddingStrategyType = "MANUAL_CPC"),
  ]) {
    const p = structuredClone(proof);
    change(p);
    assert.equal(
      prepareAcceptanceScenarios(evidence, { freshReadProof: p, now }).scenarios
        .G.status,
      "BLOCKED_NO_ELIGIBLE_AUTOMATED_EXPLICIT_CPC",
    );
  }
  proof.keyword.resourceName = proof.keyword.resourceName.replace(
    t.customer,
    t.mcc,
  );
  assert.throws(
    () => prepareAcceptanceScenarios(evidence, { freshReadProof: proof, now }),
    /owner_or_state/,
  );
});
test("H +60%2USD→3.2USD with warning, nonshared is not LIVEsharedimpact evidence", () => {
  const H = prepareAcceptanceScenarios(evidence).scenarios.H;
  assert.deepEqual(H.intent.arguments.items[0], {
    field: "campaign_daily_budget",
    campaign_id: t.campaign,
    change: { mode: "percent", percent: "60", currency: "USD" },
  });
  assert.equal(H.planned_before.amount_micros, "2000000");
  assert.equal(H.planned_after.amount_micros, "3200000");
  assert.equal(
    H.shared_impact_live_status,
    "NOT_RUN_NOT_PROVEN_BY_NONSHARED_FIXTURE",
  );
  assert.equal(H.required_warnings.includes("Change >50%"), true);
  assert.equal(H.restore.new_manual_approval_required, true);
  const budget = {
    resourceName: `${prefix}/campaignBudgets/${t.budget}`,
    amountMicros: "2000000",
    period: "DAILY",
    explicitlyShared: false,
  };
  const consumers = [
    {
      id: t.campaign,
      resourceName: `${prefix}/campaigns/${t.campaign}`,
      campaignBudget: budget.resourceName,
      status: "PAUSED",
    },
  ];
  assert.deepEqual(
    classifyBudgetImpact(budget, consumers).affected_campaign_ids,
    [t.campaign],
  );
  const shared = { ...budget, explicitlyShared: true },
    extra = {
      ...consumers[0],
      id: "24339483523",
      resourceName: `${prefix}/campaigns/24339483523`,
    };
  assert.equal(
    classifyBudgetImpact(shared, [...consumers, extra])
      .shared_impact_warning_required,
    true,
  );
  assert.throws(
    () => classifyBudgetImpact(budget, [...consumers, extra]),
    /association/,
  );
  assert.throws(
    () =>
      classifyBudgetImpact(shared, [
        consumers[0],
        {
          ...extra,
          resourceName: "customers/1111111111/campaigns/24339483523",
        },
      ]),
    /owner/,
  );
});
test("K31-char field-specific negative, L valid RSA typed and PAUSED residual/no deletion", () => {
  const plan = prepareAcceptanceScenarios(evidence),
    K = plan.scenarios.K,
    L = plan.scenarios.L;
  assert.equal(K.intent.arguments.items[0].rsa.headlines[0].text.length, 31);
  assert.equal(K.expected.field_path, "brief.items[0].rsa.headlines[0].text");
  assert.equal(K.expected.provider_calls, 0);
  const rsa = plannedRsaArguments(false).arguments.items[0].rsa;
  assert.equal(rsa.headlines.length, 3);
  assert.equal(rsa.descriptions.length, 2);
  assert.equal(
    rsa.headlines.every((h) => h.text.length <= 30),
    true,
  );
  assert.equal(
    rsa.descriptions.every((d) => d.text.length <= 90),
    true,
  );
  assert.equal(L.intent.arguments.action, "rsa_create");
  assert.equal(L.intent.arguments.items[0].status, undefined);
  assert.equal(L.planned_after.status, "PAUSED");
  assert.equal(L.residual.irreversible_removal_authorized, false);
});
test("fresh profile expiry/foreign IDs/nonTEST/public-sensitive input fail closed", () => {
  for (const change of [
    (p) => (p.customer.testAccount = false),
    (p) => (p.customer.id = t.mcc),
    (p) => (p.hierarchy.level = 2),
    (p) =>
      (p.adGroup.resourceName = "customers/1111111111/adGroups/206587491811"),
    (p) => (p.verified_at = new Date(now - 300001).toISOString()),
    (p) => (p.service_token = "synthetic"),
  ]) {
    const proof = fresh();
    change(proof);
    assert.throws(() =>
      prepareAcceptanceScenarios(evidence, { freshReadProof: proof, now }),
    );
  }
  assert.throws(() =>
    prepareAcceptanceScenarios({ ...evidence, access_token: "synthetic" }),
  );
  const p = fresh();
  p.adGroup.type = "DISPLAY_STANDARD";
  assert.equal(
    prepareAcceptanceScenarios(evidence, { freshReadProof: p, now }).scenarios.L
      .intent,
    null,
  );
});
test("preparation source contains no provider transport, mutation, approval or key issuance", () => {
  const source = readFileSync(
    new URL("./scenario-preparation.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:fetch\(|searchStream\(|\.mutate\(|confirm_preview|decideGoogleApproval|createServiceToken|commit_preview)/,
  );
  const stage2 = readFileSync(
      new URL(
        "../../../apps/api/src/mcp/mcp-google-stage2-schema.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    stage4 = readFileSync(
      new URL(
        "../../../apps/api/src/mcp/mcp-google-stage4-schema.ts",
        import.meta.url,
      ),
      "utf8",
    );
  assert.match(stage2, /google_ads_bid_budget_preview/);
  assert.match(stage2, /keyword_cpc/);
  assert.match(stage2, /campaign_daily_budget/);
  assert.match(stage4, /google_ads_ads_assets_preview/);
  assert.match(stage4, /rsa_create/);
});
