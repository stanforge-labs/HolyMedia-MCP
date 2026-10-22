import { currencyMicros, type Stage1Reader } from "./google-ads-stage1.js";
import {
  alignedMoneyMicros,
  resolveGoogleMoneyUnit,
} from "./google-ads-money.js";
import {
  assertExtendedPlan,
  extClosed,
  extContext,
  extFail,
  extId,
  extItem,
  extOwner,
  extQuote,
  extRow,
  type ExtendedPlan,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";

export const SHARED_BUDGET_SETUP_ACTION = "stage2_shared_budget";
export const SHARED_BUDGET_CAMPAIGN_QUERY =
  "SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign.bidding_strategy_type, campaign.bidding_strategy, campaign.experiment_type, campaign.manual_cpc.enhanced_cpc_enabled, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.tracking_url_template, campaign.final_url_suffix, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type FROM campaign WHERE campaign.status != REMOVED";
export const SHARED_BUDGET_QUERY =
  "SELECT campaign_budget.id, campaign_budget.resource_name, campaign_budget.name, campaign_budget.status, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period, campaign_budget.delivery_method, campaign_budget.type, campaign_budget.aligned_bidding_strategy_id FROM campaign_budget WHERE campaign_budget.status != REMOVED";

export function parseSharedBudgetSetup(
  raw: unknown,
): ExtendedRow & { action: string } {
  const r = extRow(raw);
  if (r.operation === "create_and_attach") {
    extClosed(
      raw,
      ["action", "operation", "name", "daily_budget", "campaign_ids"],
      ["action", "operation", "name", "daily_budget", "campaign_ids"],
    );
    if (
      typeof r.name !== "string" ||
      !/^HM_MCP_ACCEPTANCE_SHARED_[A-Za-z0-9_-]{1,210}$/.test(r.name)
    )
      extFail(
        "google_shared_setup_name_invalid",
        "TEST shared budget: уникальное имя с префиксом HM_MCP_ACCEPTANCE_SHARED_.",
      );
    const money = extClosed(
      r.daily_budget,
      ["amount", "currency"],
      ["amount", "currency"],
    );
    if (
      typeof money.amount !== "string" ||
      !/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,6})?$/.test(money.amount) ||
      Number(money.amount) <= 0 ||
      typeof money.currency !== "string" ||
      !/^[A-Z]{3}$/.test(money.currency)
    )
      extFail(
        "google_shared_setup_money_invalid",
        "Положительный daily amount строкой и ISO currency обязательны.",
      );
    if (!Array.isArray(r.campaign_ids) || r.campaign_ids.length !== 2)
      extFail(
        "google_shared_setup_limit",
        "Создание TEST shared budget требует ровно две существующие PAUSED campaigns.",
      );
    const ids = r.campaign_ids.map((id) => extId(id, "campaign_id"));
    if (new Set(ids).size !== 2)
      extFail(
        "google_shared_setup_duplicate",
        "Campaign IDs должны быть различными.",
      );
  } else if (r.operation === "assign") {
    extClosed(
      raw,
      ["action", "operation", "assignments"],
      ["action", "operation", "assignments"],
    );
    if (
      !Array.isArray(r.assignments) ||
      !r.assignments.length ||
      r.assignments.length > 2
    )
      extFail(
        "google_shared_setup_limit",
        "TEST assignment/restore: одна или две точечные строки, без truncation.",
      );
    const ids = r.assignments.map((rawRow) => {
      const a = extClosed(
        rawRow,
        ["campaign_id", "budget_id"],
        ["campaign_id", "budget_id"],
      );
      extId(a.budget_id, "budget_id");
      return extId(a.campaign_id, "campaign_id");
    });
    if (new Set(ids).size !== ids.length)
      extFail(
        "google_shared_setup_duplicate",
        "Campaign нельзя менять дважды.",
      );
  } else
    extFail(
      "google_shared_setup_operation_invalid",
      "Разрешены create_and_attach либо assign; remove/clear/toggle shared запрещены.",
    );
  if (r.action !== SHARED_BUDGET_SETUP_ACTION)
    extFail(
      "google_shared_setup_operation_invalid",
      "Неверный typed shared-budget action.",
    );
  return r as ExtendedRow & { action: string };
}

/** TEST-only setup; public/default gates and stock approval lifecycle are unchanged. */
export async function buildSharedBudgetSetupPlan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  const intent = parseSharedBudgetSetup(raw),
    ctx = await extContext(account, read);
  const proof = await ctx.query(
    "SELECT customer.id, customer.resource_name, customer.currency_code, customer.test_account FROM customer",
  );
  if (
    proof.length !== 1 ||
    String(extRow(proof[0]?.customer).id) !== ctx.account_id ||
    extRow(proof[0]?.customer).resourceName !== `customers/${ctx.account_id}` ||
    extRow(proof[0]?.customer).currencyCode !== ctx.currency ||
    extRow(proof[0]?.customer).testAccount !== true
  )
    extFail(
      "google_shared_setup_test_account_required",
      "Shared-budget setup разрешён только provider-proved TEST customer; production не поддерживается.",
    );
  const unit = await resolveGoogleMoneyUnit(ctx.currency, ctx.query);
  const campaignRows = await ctx.query(SHARED_BUDGET_CAMPAIGN_QUERY),
    budgetRows = await ctx.query(SHARED_BUDGET_QUERY);
  if (campaignRows.length >= 5000 || budgetRows.length >= 5000)
    extFail(
      "google_shared_setup_inventory_limit",
      "Полный consumer/budget inventory не доказан в bounded TEST profile.",
    );
  const campaigns = new Map<string, ExtendedRow>(),
    budgets = new Map<string, ExtendedRow>();
  for (const row of campaignRows) {
    const c = extRow(row.campaign),
      id = extId(String(c.id));
    const resource = extOwner(c.resourceName, ctx.account_id, "campaigns");
    if (
      resource !== `customers/${ctx.account_id}/campaigns/${id}` ||
      campaigns.has(id)
    )
      extFail(
        "google_extended_ownership_invalid",
        "Duplicate/mismatched campaign proof.",
      );
    extOwner(c.campaignBudget, ctx.account_id, "campaignBudgets");
    campaigns.set(id, c);
  }
  for (const row of budgetRows) {
    const b = extRow(row.campaignBudget),
      id = extId(String(b.id));
    const resource = extOwner(
      b.resourceName,
      ctx.account_id,
      "campaignBudgets",
    );
    if (
      resource !== `customers/${ctx.account_id}/campaignBudgets/${id}` ||
      budgets.has(id)
    )
      extFail(
        "google_extended_ownership_invalid",
        "Duplicate/mismatched budget proof.",
      );
    budgets.set(id, b);
  }
  const eligibleCampaign = (id: string) => {
    const c = campaigns.get(id);
    if (!c)
      extFail(
        "google_shared_setup_object_unavailable",
        "Campaign отсутствует в selected TEST customer.",
      );
    if (
      c.status !== "PAUSED" ||
      c.advertisingChannelType !== "SEARCH" ||
      c.biddingStrategyType !== "MANUAL_CPC" ||
      c.experimentType !== "BASE" ||
      c.biddingStrategy ||
      extRow(c.manualCpc).enhancedCpcEnabled === true
    )
      extFail(
        "google_shared_setup_campaign_incompatible",
        "TEST budget setup: только PAUSED BASE Search, standard MANUAL_CPC; auto/portfolio/experiment не изменяются.",
      );
    return c;
  };
  const eligibleBudget = (id: string) => {
    const b = budgets.get(id);
    if (!b)
      extFail(
        "google_shared_setup_object_unavailable",
        "Budget отсутствует или REMOVED; исходный ID не заменяется угаданным.",
      );
    if (
      b.status !== "ENABLED" ||
      b.period !== "DAILY" ||
      b.deliveryMethod !== "STANDARD" ||
      b.type !== "STANDARD" ||
      (b.explicitlyShared !== false && b.explicitlyShared !== true) ||
      ![undefined, "0", 0].includes(
        b.alignedBiddingStrategyId as undefined | string | number,
      ) ||
      !alignedMoneyMicros(b.amountMicros, unit)
    )
      extFail(
        "google_shared_setup_budget_incompatible",
        "Требуется genuine DAILY STANDARD budget, exact aligned currency micros, без portfolio alignment.",
      );
    return b;
  };
  const creation = intent.operation === "create_and_attach",
    temp = `customers/${ctx.account_id}/campaignBudgets/-1`;
  const changes = creation
    ? (intent.campaign_ids as string[]).map((id) => ({
        campaign_id: id,
        budget_resource: temp,
      }))
    : (intent.assignments as ExtendedRow[]).map((a) => ({
        campaign_id: String(a.campaign_id),
        budget_resource: String(
          eligibleBudget(String(a.budget_id)).resourceName,
        ),
      }));
  const touchedBudgets = new Set<string>();
  for (const change of changes) {
    const c = eligibleCampaign(change.campaign_id),
      before = eligibleBudget(String(c.campaignBudget).split("/").at(-1)!);
    if (c.campaignBudget === change.budget_resource)
      extFail(
        "google_shared_setup_noop",
        "Budget reference уже совпадает; лишняя mutation не создаётся.",
      );
    if (creation && before.explicitlyShared !== false)
      extFail(
        "google_shared_setup_source_not_private",
        "Первичный shared setup требует два доказанных nonshared source budgets; последующий detach использует assign.",
      );
    touchedBudgets.add(String(c.campaignBudget));
    touchedBudgets.add(change.budget_resource);
  }
  const consumersBefore = campaignRows.filter((row) =>
    touchedBudgets.has(String(extRow(row.campaign).campaignBudget)),
  );
  if (consumersBefore.length > 50)
    extFail(
      "google_shared_setup_inventory_limit",
      "Shared impact превышает 50 TEST consumers; batch не расширяется молча.",
    );
  for (const row of consumersBefore)
    eligibleCampaign(String(extRow(row.campaign).id));
  const after: ExtendedRow[] = [...campaigns.values()].map((c) => ({
    ...c,
    campaignBudget:
      changes.find((a) => a.campaign_id === String(c.id))?.budget_resource ??
      c.campaignBudget,
  }));
  for (const resource of touchedBudgets) {
    if (resource === temp) continue;
    const b = eligibleBudget(resource.split("/").at(-1)!);
    if (
      !b.explicitlyShared &&
      after.filter((c) => c.campaignBudget === resource).length > 1
    )
      extFail(
        "google_shared_setup_budget_not_shareable",
        "Nonshared budget нельзя назначить второй campaign; shared flag не переключается.",
      );
  }
  const operations: ExtendedPlan["operations"] = [],
    items: ExtendedPlan["items"] = [];
  const affectedBefore = consumersBefore.map((r) =>
    structuredClone(extRow(r.campaign)),
  );
  const affectedAfter = after.filter((c) =>
    touchedBudgets.has(String(c.campaignBudget)),
  );
  const commonWarnings = [
    "TEST-only atomic setup; status, bidding, geo и соседние поля не меняются. Google validate_only + отдельный human approval обязательны.",
    "Affected consumers frozen before/after; commit не расширяет выбранные campaign IDs. Отвязка требует нового approved assign preview.",
    `Consumers BEFORE: ${consumersBefore.map((r) => String(extRow(r.campaign).resourceName)).join(", ") || "none"}; AFTER: ${after
      .filter((c) => touchedBudgets.has(String(c.campaignBudget)))
      .map((c) => `${c.resourceName} => ${c.campaignBudget}`)
      .join(", ")}.`,
  ];
  if (creation) {
    if (
      budgetRows.some(
        (r) =>
          String(extRow(r.campaignBudget).name)
            .normalize("NFC")
            .toLocaleLowerCase() === String(intent.name).toLocaleLowerCase(),
      )
    )
      extFail(
        "google_shared_setup_name_conflict",
        "Имя budget уже существует; create не повторяется.",
      );
    const money = extRow(intent.daily_budget),
      micros = currencyMicros(
        String(money.amount),
        String(money.currency),
        ctx.currency,
      );
    if (!alignedMoneyMicros(micros, unit))
      extFail(
        "google_shared_setup_money_invalid",
        "Setup daily amount должен точно совпадать с Google billable unit; скрытое округление запрещено.",
      );
    const fields = {
      resourceName: temp,
      name: intent.name,
      amountMicros: micros,
      explicitlyShared: true,
      deliveryMethod: "STANDARD",
      period: "DAILY",
      type: "STANDARD",
    };
    const expected = { ...fields, status: "ENABLED" };
    operations.push({
      kind: "campaignBudgets",
      method: "create",
      resource_name: temp,
      fields,
      update_mask: null,
      before: null,
      expected,
      row: 0,
      read_query:
        SHARED_BUDGET_QUERY +
        ` AND campaign_budget.resource_name = ${extQuote(temp)}`,
      response_key: "campaignBudget",
    });
    const item = extItem(0, "create TEST shared DAILY budget");
    item.before = { budget: null, affected_campaigns: affectedBefore };
    item.after = { budget: expected, affected_campaigns: affectedAfter };
    item.provider_operations = [0];
    item.warnings = [
      ...commonWarnings,
      "Shared budget name independent; residual budget останется существовать после отдельного detach. Auto-delete rollback не поддерживается.",
    ];
    items.push(item);
  }
  const inverse: ExtendedRow[] = [];
  for (const change of changes) {
    const c = eligibleCampaign(change.campaign_id),
      index = items.length;
    const expected = { ...c, campaignBudget: change.budget_resource },
      fields = {
        resourceName: c.resourceName,
        campaignBudget: change.budget_resource,
      };
    operations.push({
      kind: "campaigns",
      method: "update",
      resource_name: String(c.resourceName),
      fields,
      update_mask: "campaign_budget",
      before: c,
      expected,
      row: index,
      read_query:
        SHARED_BUDGET_CAMPAIGN_QUERY +
        ` AND campaign.id = ${change.campaign_id}`,
      response_key: "campaign",
    });
    const item = extItem(
      index,
      "assign TEST campaign budget",
      change.campaign_id,
    );
    item.before = { ...c, affected_campaigns: affectedBefore };
    item.after = { ...expected, affected_campaigns: affectedAfter };
    item.provider_operations = [operations.length - 1];
    item.warnings = [
      ...commonWarnings,
      `Restore source budget ID: ${String(c.campaignBudget).split("/").at(-1)}; identity/currency проверяются заново, новый budget не удаляется автоматически.`,
    ];
    items.push(item);
    inverse.push({
      campaign_id: change.campaign_id,
      budget_id: String(c.campaignBudget).split("/").at(-1),
    });
  }
  const plan: ExtendedPlan = {
    version: 5,
    account_id: ctx.account_id,
    intent,
    checks: ctx.checks,
    operations,
    items,
    atomic: true,
    irreversible: false,
  };
  // Stock rollback rejects creation plans: recovery is explicit new assign, not auto removal.
  if (!creation)
    plan.inverse_intent = {
      action: SHARED_BUDGET_SETUP_ACTION,
      operation: "assign",
      assignments: inverse,
    };
  assertExtendedPlan(plan, account);
  return plan;
}
