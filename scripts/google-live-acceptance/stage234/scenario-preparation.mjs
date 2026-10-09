// Pure local planning only. No fetch, provider client, preview, approval or commit.
import { createHash } from "node:crypto";

export const scenarioTarget = Object.freeze({
  customer: "8590146099",
  mcc: "4378327049",
  campaign: "24324170853",
  group: "206587491811",
  keyword: "11743561",
  budget: "15934365976",
  rsa: "827349040712",
});
export const scenarioBaseline = "94edb8c3c082bbd8951bf166e8797e83f3b8a5dc";
const prefix = `customers/${scenarioTarget.customer}`;
const fail = (code) => {
  throw new Error(code);
};
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const containsSecretKey = (value) =>
  value &&
  typeof value === "object" &&
  Object.entries(value).some(
    ([k, v]) =>
      /(?:access_token|refresh_token|preview_token|service_token|client_secret|password|cookie|authorization|encrypted_payload|oauth_code|code_verifier)/i.test(
        k,
      ) || containsSecretKey(v),
  );
const tool = (name, items, extra = {}) => ({
  name,
  arguments: {
    provider: "GOOGLE_ADS",
    account_id: scenarioTarget.customer,
    ...extra,
    items,
  },
});
const money = (mode, value) =>
  mode === "absolute"
    ? { mode, amount: value, currency: "USD" }
    : { mode, percent: value, currency: "USD" };
const bidRow = (field, change) => ({
  field,
  campaign_id: scenarioTarget.campaign,
  ...(field !== "campaign_daily_budget"
    ? { ad_group_id: scenarioTarget.group }
    : {}),
  ...(field === "keyword_cpc" ? { criterion_id: scenarioTarget.keyword } : {}),
  change,
});
export function plannedRsaArguments(invalid = false) {
  return tool(
    "google_ads_ads_assets_preview",
    [
      {
        campaign_id: scenarioTarget.campaign,
        ad_group_id: scenarioTarget.group,
        rsa: {
          final_url: "https://mcp.holymedia.kz/",
          headlines: [
            { text: invalid ? "A".repeat(31) : "HolyMedia MCP Test" },
            { text: "Paused TEST Acceptance" },
            { text: "Stage 4 Safe Test" },
          ],
          descriptions: [
            { text: "Controlled TEST account. Ad is created paused." },
            { text: "No customer advertising. Manual approval required." },
          ],
        },
      },
    ],
    { action: "rsa_create" },
  );
}
export function classifyBudgetImpact(budget, consumers) {
  if (
    budget?.resourceName !==
      `${prefix}/campaignBudgets/${scenarioTarget.budget}` ||
    budget.period !== "DAILY" ||
    !/^[1-9][0-9]*$/.test(String(budget.amountMicros)) ||
    typeof budget.explicitlyShared !== "boolean" ||
    !Array.isArray(consumers) ||
    !consumers.length ||
    consumers.length > 500
  )
    fail("scenario_budget_proof_invalid");
  const seen = new Set();
  for (const c of consumers) {
    if (
      !/^[0-9]{1,20}$/.test(String(c.id)) ||
      c.resourceName !== `${prefix}/campaigns/${c.id}` ||
      c.campaignBudget !== budget.resourceName ||
      c.status === "REMOVED" ||
      seen.has(String(c.id))
    )
      fail("scenario_budget_consumer_owner_or_duplicate_invalid");
    seen.add(String(c.id));
  }
  if (
    !seen.has(scenarioTarget.campaign) ||
    (!budget.explicitlyShared && consumers.length !== 1)
  )
    fail("scenario_budget_association_invalid");
  return {
    shared: budget.explicitlyShared,
    affected_campaign_ids: [...seen].sort(),
    shared_impact_warning_required:
      budget.explicitlyShared || consumers.length > 1,
    greater_than_50_percent_warning_required: true,
  };
}
export function assertPlanningEvidence(evidence) {
  if (containsSecretKey(evidence)) fail("scenario_secret_data_not_accepted");
  if (
    evidence?.test_customer_id !== scenarioTarget.customer ||
    evidence.login_customer_id !== scenarioTarget.mcc ||
    evidence.test_account !== true ||
    evidence.hierarchy !== "PASS" ||
    evidence.account_currency !== "USD" ||
    !Number.isFinite(Date.parse(evidence.timestamp)) ||
    evidence.production_changed !== false ||
    evidence.main_changed !== false
  )
    fail("scenario_test_account_evidence_invalid");
  if (
    evidence.campaigns?.[scenarioTarget.campaign] !== "PAUSED" ||
    evidence.campaigns?.["24339483523"] !== "PAUSED" ||
    evidence.ad_groups !== "3 PAUSED" ||
    evidence.rsa !== "3 PAUSED" ||
    evidence.original_keywords !== "20 ENABLED" ||
    evidence.residual_phrase?.criterion_id !== "11479221" ||
    evidence.residual_phrase.status !== "PAUSED" ||
    evidence.group_cpc_micros !== "100000" ||
    evidence.shared_negative_list?.active_attachments !== 0
  )
    fail("scenario_fixture_observation_unexpected");
}
function freshProfile(proof, now) {
  if (!proof) return null;
  if (containsSecretKey(proof)) fail("scenario_secret_data_not_accepted");
  const age = now - Date.parse(proof.verified_at);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > 300000 ||
    !/^[a-f0-9]{40}$/.test(proof.source_head ?? "")
  )
    fail("scenario_fresh_read_proof_expired");
  if (
    proof.customer?.id !== scenarioTarget.customer ||
    proof.customer.testAccount !== true ||
    proof.customer.currencyCode !== "USD" ||
    proof.mcc?.id !== scenarioTarget.mcc ||
    proof.mcc.testAccount !== true ||
    proof.hierarchy?.id !== scenarioTarget.customer ||
    proof.hierarchy.testAccount !== true ||
    proof.hierarchy.level !== 1
  )
    fail("scenario_fresh_test_hierarchy_invalid");
  if (
    proof.campaign?.id !== scenarioTarget.campaign ||
    proof.campaign.resourceName !==
      `${prefix}/campaigns/${scenarioTarget.campaign}` ||
    proof.campaign.status !== "PAUSED" ||
    proof.adGroup?.id !== scenarioTarget.group ||
    proof.adGroup.resourceName !==
      `${prefix}/adGroups/${scenarioTarget.group}` ||
    proof.adGroup.status !== "PAUSED"
  )
    fail("scenario_fresh_owned_parent_invalid");
  return proof;
}
export function prepareAcceptanceScenarios(
  evidence,
  { freshReadProof, now = Date.now() } = {},
) {
  assertPlanningEvidence(evidence);
  const fresh = freshProfile(freshReadProof, now),
    groupResource = `${prefix}/adGroups/${scenarioTarget.group}`;
  const base = {
    status: "PREPARED_NOT_RUN",
    live_pass: false,
    preview_created: false,
    commit_authorized: false,
    real_provider_read_calls: 0,
    validate_only_calls: 0,
    real_provider_write_calls: 0,
  };
  const N = {
    ...base,
    prerequisite:
      "Fresh TEST/MCC/USD/billable-unit proof, group CPC100000 and immutable paused fixture; one sole scoped stock-issued key; no other pending preview.",
    planned_before: {
      resource_name: groupResource,
      cpc_bid_micros: "100000",
      status: "PAUSED",
    },
    planned_after: {
      resource_name: groupResource,
      cpc_bid_micros: "110000",
      status: "PAUSED",
    },
    intent: tool("google_ads_bid_budget_preview", [
      bidRow("ad_group_cpc", money("absolute", "0.11")),
    ]),
    restore: {
      tool: "preview_rollback_commit",
      arguments_source:
        "ONLY verified N commit_id; do not invent/reuse a commit ID",
      expected_cpc_micros: "100000",
      new_manual_approval_required: true,
    },
    actual_fresh_bid: fresh?.adGroup.cpcBidMicros ?? null,
  };
  if (fresh && String(fresh.adGroup.cpcBidMicros) !== "100000") {
    N.status = "BLOCKED_PROVIDER_BID_DRIFT";
    N.intent = null;
  }
  const H = {
    ...base,
    prerequisite:
      "Fresh DAILY non-shared budget15934365976=2000000, exactly one owned consumer24324170853; complete consumer inventory before approval.",
    before_basis: "Historical fixture contract, not a new provider read",
    planned_before: {
      budget_resource: `${prefix}/campaignBudgets/${scenarioTarget.budget}`,
      amount_micros: "2000000",
      explicitly_shared: false,
    },
    planned_after: {
      amount_micros: "3200000",
      currency: "USD",
      shared_state_unchanged: true,
    },
    intent: tool("google_ads_bid_budget_preview", [
      bidRow("campaign_daily_budget", money("percent", "60")),
    ]),
    required_warnings: ["Change >50%"],
    shared_impact_live_status: "NOT_RUN_NOT_PROVEN_BY_NONSHARED_FIXTURE",
    restore: {
      tool: "preview_rollback_commit",
      arguments_source: "ONLY verified H commit_id",
      expected_amount_micros: "2000000",
      new_manual_approval_required: true,
    },
  };
  if (fresh?.budget) {
    H.actual_fresh_impact = classifyBudgetImpact(
      fresh.budget,
      fresh.budgetConsumers,
    );
    if (
      fresh.budget.amountMicros !== "2000000" ||
      fresh.budget.explicitlyShared !== false ||
      fresh.campaign.campaignBudget !== fresh.budget.resourceName
    ) {
      H.status = "BLOCKED_CHANGED_BUDGET_PROFILE";
      H.intent = null;
    }
  }
  const G = {
    ...base,
    status: "BLOCKED_NO_ELIGIBLE_AUTOMATED_EXPLICIT_CPC",
    prerequisite:
      "Fresh positive owned keyword with provider-proven explicit >0 CPC and automated strategy; no implicit switch from manual to automatic.",
    conditional_intent_not_authorized: tool("google_ads_bid_budget_preview", [
      bidRow("keyword_cpc", money("percent", "10")),
    ]),
    planned_before: null,
    planned_after: {
      percent: "+10",
      exact_micros_source:
        "Stock builder + authoritative USD billable unit; never invent inherited effective CPC",
    },
    required_warning:
      "Manual CPC override under automated/portfolio bidding may not affect effective bids; strategy unchanged",
    required_before: {
      positive_keyword: true,
      explicit_cpc_field: "ad_group_criterion.cpc_bid_micros",
      existing_identity: `${prefix}/adGroupCriteria/${scenarioTarget.group}~${scenarioTarget.keyword}`,
    },
  };
  if (fresh?.keyword) {
    const k = fresh.keyword;
    if (
      k.resourceName !== G.required_before.existing_identity ||
      String(k.criterionId) !== scenarioTarget.keyword ||
      k.type !== "KEYWORD" ||
      k.negative !== false ||
      k.status !== "ENABLED"
    )
      fail("scenario_keyword_owner_or_state_invalid");
    if (
      fresh.campaign.biddingStrategy !== undefined &&
      !new RegExp(`^${prefix}/biddingStrategies/[0-9]{1,20}$`).test(
        fresh.campaign.biddingStrategy,
      )
    )
      fail("scenario_strategy_owner_invalid");
    const auto = [
      "TARGET_SPEND",
      "MAXIMIZE_CONVERSIONS",
      "MAXIMIZE_CONVERSION_VALUE",
      "TARGET_CPA",
      "TARGET_ROAS",
      "TARGET_IMPRESSION_SHARE",
    ].includes(fresh.campaign.biddingStrategyType);
    if (auto && /^[1-9][0-9]*$/.test(String(k.cpcBidMicros))) {
      G.status = "ELIGIBLE_READ_ONLY_PREVIEW_NOT_STARTED";
      G.planned_before = {
        resource_name: k.resourceName,
        cpc_bid_micros: String(k.cpcBidMicros),
        bidding_strategy_type: fresh.campaign.biddingStrategyType,
      };
    }
  }
  const K = {
    ...base,
    status: "PREPARED_LOCAL_SCHEMA_NEGATIVE_NOT_LIVE",
    intent: plannedRsaArguments(true),
    expected: {
      rejected: true,
      source: "HOLYMEDIA",
      code: "google_brief_invalid",
      field_path: "brief.items[0].rsa.headlines[0].text",
      google_errors: [],
      preview_created: false,
      provider_calls: 0,
    },
    note: "Do not accept a gate/auth/provider error instead of field-specific schema rejection.",
  };
  const L = {
    ...base,
    intent: plannedRsaArguments(false),
    prerequisite:
      "Fresh campaign SEARCH / group SEARCH_STANDARD, both PAUSED; reread RSA inventory and reject duplicate; Stage4 gate only disposable, Google policy validation remains required.",
    planned_before: { equivalent_new_rsa: "ABSENT_REQUIRES_FRESH_INVENTORY" },
    planned_after: {
      ad_group_resource: groupResource,
      status: "PAUSED",
      count_added: 1,
    },
    expected_warnings: [
      "RSA creates PAUSED; Google moderation/policy validation; no implicit activation",
    ],
    residual: {
      new_ad_id: null,
      retained_status: "PAUSED",
      irreversible_removal_authorized: false,
      record_resource_id_from_verified_reread: true,
    },
  };
  if (
    fresh &&
    (fresh.campaign.advertisingChannelType !== "SEARCH" ||
      fresh.adGroup.type !== "SEARCH_STANDARD")
  ) {
    L.status = "BLOCKED_NON_SEARCH_STANDARD_PROFILE";
    L.intent = null;
  }
  return {
    kind: "LOCAL_PLANNING_NOT_LIVE_ACCEPTANCE",
    baseline_head: scenarioBaseline,
    test_customer_id: scenarioTarget.customer,
    test_mcc: scenarioTarget.mcc,
    observation: {
      timestamp: evidence.timestamp,
      read_runtime_image_source: evidence.actual_read_runtime_image_source,
      semantic_sha256: createHash("sha256")
        .update(canonical(evidence))
        .digest("hex"),
      historical_provider_read_calls: evidence.provider_read_calls,
      note: "Recorded observation can be stale; no fresh read executed by this module.",
    },
    execution_order: [
      "K schema-only (independent)",
      "N JIT preview, human approval, commit, new rollback preview, human approval, restore verification",
      "H JIT +60%, approval, commit, new inverse approval, restore verification",
      "L JIT RSA preview, approval, commit, PAUSED residual verification",
      "G only after eligible fresh automatic/explicit CPC proof; otherwise BLOCKED",
    ],
    policy: {
      pending_approvals_max: 1,
      first_live_jit: "N",
      self_approval: false,
      automatic_commit: false,
      automatic_retry: false,
      raw_mutation: false,
      production_changed: false,
      main_changed: false,
      other_accounts_allowed: false,
      fresh_approval_and_stale_checks_before_each_commit: true,
      real_provider_calls_in_preparation: 0,
    },
    scenarios: { G, H, K, L, N },
  };
}
