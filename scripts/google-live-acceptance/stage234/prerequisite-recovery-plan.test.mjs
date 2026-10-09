import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
const { tsImport } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("tsx/esm/api");
const identity = { provider: "GOOGLE_ADS", account_id: "8590146099" };
test("proposed G setup/H update remain exact typed stock schemas, not raw provider or auto approval", async () => {
  const { stage2ToolIntent } = await tsImport(
      "../../../apps/api/src/mcp/mcp-google-stage2-schema.ts",
      import.meta.url,
    ),
    { stage2AdvancedToolIntent } = await tsImport(
      "../../../apps/api/src/mcp/mcp-google-stage2-advanced-schema.ts",
      import.meta.url,
    );
  assert.ok(
    stage2ToolIntent("google_ads_bid_budget_preview", {
      ...identity,
      items: [
        {
          field: "keyword_cpc",
          campaign_id: "24324170853",
          ad_group_id: "206587491811",
          criterion_id: "11743561",
          change: { mode: "absolute", amount: "0.10", currency: "USD" },
        },
      ],
    }),
  );
  assert.ok(
    stage2AdvancedToolIntent("google_ads_strategy_modifier_preview", {
      ...identity,
      items: [
        {
          operation: "campaign_strategy",
          campaign_id: "24324170853",
          strategy: {
            type: "MAXIMIZE_CLICKS",
            cpc_ceiling: { amount: "1.00", currency: "USD" },
          },
        },
      ],
    }),
  );
  assert.ok(
    stage2ToolIntent("google_ads_bid_budget_preview", {
      ...identity,
      items: [
        {
          field: "campaign_daily_budget",
          campaign_id: "24324170853",
          change: { mode: "percent", percent: "60", currency: "USD" },
        },
      ],
    }),
  );
  assert.throws(() =>
    stage2AdvancedToolIntent("google_ads_strategy_modifier_preview", {
      ...identity,
      items: [
        {
          operation: "campaign_strategy",
          campaign_id: "24324170853",
          strategy: { type: "MAXIMIZE_CLICKS" },
          raw_google_payload: {},
        },
      ],
    }),
  );
});
test("I/J restore typed mock-only IDs require irreversible acknowledgment, never an invented live ID", async () => {
  const { stage3ToolIntent } = await tsImport(
    "../../../apps/api/src/mcp/mcp-google-stage3-schema.ts",
    import.meta.url,
  );
  const rows = [
    {
      operation: "audience_remove",
      level: "AD_GROUP",
      campaign_id: "24324170853",
      ad_group_id: "206587491811",
      criterion_id: "90001",
      acknowledge_irreversible: true,
    },
    {
      operation: "criterion_remove",
      level: "CAMPAIGN",
      campaign_id: "24324170853",
      criterion_id: "90002",
      criterion_type: "LOCATION",
      acknowledge_irreversible: true,
    },
    {
      operation: "criterion_remove",
      level: "CAMPAIGN",
      campaign_id: "24324170853",
      criterion_id: "90003",
      criterion_type: "PROXIMITY",
      acknowledge_irreversible: true,
    },
  ];
  for (const row of rows) {
    assert.ok(
      stage3ToolIntent("google_ads_targeting_preview", {
        ...identity,
        items: [row],
      }),
    );
    assert.throws(() =>
      stage3ToolIntent("google_ads_targeting_preview", {
        ...identity,
        items: [{ ...row, acknowledge_irreversible: false }],
      }),
    );
  }
});
test("plan preserves diagnostic evidence boundaries and declares exact stock prerequisite gaps", () => {
  const artifact = (name) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../../../artifacts/google-full-scope/${name}`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  const H = artifact("H-warning-only-20261010.json"),
    eligibility = artifact("eligibility-recovery-20261010.json"),
    doc = readFileSync(
      new URL(
        "../../../docs/google-ads-prerequisite-setup-recovery-20261010.md",
        import.meta.url,
      ),
      "utf8",
    );
  assert.equal(H.full_mcp_approval_commit_acceptance, false);
  assert.equal(H.shared_budget_live_verified, false);
  assert.equal(H.real_provider_write_call_count, 0);
  assert.equal(eligibility.G.observed_paused_auto_search_campaigns, 0);
  assert.equal(eligibility.I.no_global_absence_claim, true);
  assert.equal(eligibility.J.existing_provider_proximity_centers_observed, 0);
  for (const phrase of [
    "6 separate approvals",
    "2 approvals",
    "no honest stock shared-budget create/attach tool",
    "Country-/language-specific eligibility is not enabled",
    "No direct district",
    "No automatic goal/asset/campaign removal",
  ])
    assert.ok(doc.includes(phrase), phrase);
});
