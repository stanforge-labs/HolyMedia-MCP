import type { AppConfig } from "@holymedia/config";
import {
  resolveGoogleMoneyUnit,
  quantizePositiveMicros,
  moneyUnitWarnings,
  moneyUnitFromRows,
  alignedMoneyMicros,
  currencyConstantQuery,
  type GoogleMoneyUnit,
} from "./google-ads-money.js";
import {
  canonical,
  currencyMicros,
  type Stage1Reader,
  type Stage1MutationResult,
  type Stage1Plan,
} from "./google-ads-stage1.js";
import {
  assertGoogleWriteAccount,
  customerId,
  GoogleAdsWriteError,
  googleWriteFailure,
} from "./google-ads-write.js";

type Row = Record<string, unknown>;
export type Stage2Field =
  | "keyword_cpc"
  | "ad_group_cpc"
  | "ad_group_target_cpa"
  | "campaign_daily_budget";
export type Stage2Change =
  | { mode: "absolute"; amount: string; currency: string }
  | { mode: "percent"; percent: string; currency: string }
  | { mode: "inherit"; currency: string; proof: Stage2InheritedCpcProof };
export type Stage2InheritedCpcProof = {
  source: "AD_GROUP";
  effective_cpc_bid_micros: string;
  parent_resource_name: string;
  parent_cpc_bid_micros: string;
  campaign_resource_name: string;
};
export type Stage2Item = {
  field: Stage2Field;
  campaign_id: string;
  ad_group_id?: string;
  criterion_id?: string;
  change: Stage2Change;
};
export type Stage2Intent = {
  action: "bid_budget_update" | "bid_budget_inherited_rollback";
  items: Stage2Item[];
};
export type Stage2Operation = {
  kind: "adGroupCriteria" | "adGroups" | "campaignBudgets";
  method: "update";
  resource_name: string;
  fields: Row;
  update_mask: string;
  before: Row;
  expected: Row;
  row: number;
  read_query: string;
  response_key: string;
  inherited_before?: Stage2InheritedCpcProof;
  inherited_after?: Stage2InheritedCpcProof;
};
export type Stage2Plan = {
  version: 2;
  account_id: string;
  intent: Stage2Intent;
  checks: { query: string; rows: Row[] }[];
  operations: Stage2Operation[];
  items: (Stage1Plan["items"][number] & {
    row_error?: { source: "HOLYMEDIA"; code: string; message: string };
  })[];
};
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
function fail(code: string, message: string): never {
  throw new GoogleAdsWriteError(code, message);
}
const fields: Stage2Field[] = [
  "keyword_cpc",
  "ad_group_cpc",
  "ad_group_target_cpa",
  "campaign_daily_budget",
];
const id = (v: unknown) => typeof v === "string" && /^[0-9]{1,20}$/.test(v);
export function assertStage2Gate(config: AppConfig, account: string) {
  assertGoogleWriteAccount(config, account);
  if (!config.providerGoogleAdsStage2WriteEnabled)
    fail(
      "google_stage2_disabled",
      "Google Ads Stage 2 выключен; preview/commit/rollback недоступны.",
    );
}
export function parseStage2Intent(input: unknown): Stage2Intent {
  const r = record(input);
  if (
    Object.keys(r).some((k) => !["action", "items"].includes(k)) ||
    typeof r.action !== "string" ||
    !["bid_budget_update", "bid_budget_inherited_rollback"].includes(
      r.action,
    ) ||
    !Array.isArray(r.items) ||
    !r.items.length ||
    r.items.length > 500
  )
    fail(
      "google_stage2_input_invalid",
      "Укажите 1–500 typed bid/budget строк без произвольных Google payload.",
    );
  const seen = new Set<string>();
  const items = r.items.map((raw) => {
    const x = record(raw),
      field = x.field as Stage2Field;
    const required = [
      "field",
      "campaign_id",
      "change",
      ...(field !== "campaign_daily_budget" ? ["ad_group_id"] : []),
      ...(field === "keyword_cpc" ? ["criterion_id"] : []),
    ];
    if (
      !fields.includes(field) ||
      Object.keys(x).some((k) => !required.includes(k)) ||
      required.some((k) => x[k] === undefined) ||
      !id(x.campaign_id) ||
      (field !== "campaign_daily_budget" && !id(x.ad_group_id)) ||
      (field === "keyword_cpc" && !id(x.criterion_id))
    )
      fail(
        "google_stage2_identity_invalid",
        "Требуются campaign/ad group/criterion ID выбранного account; resource names и лишние поля запрещены.",
      );
    const c = record(x.change);
    if (c.mode === "inherit") {
      if (
        r.action !== "bid_budget_inherited_rollback" ||
        field !== "keyword_cpc" ||
        Object.keys(c).sort().join(",") !== "currency,mode,proof" ||
        typeof c.currency !== "string" ||
        !/^[A-Z]{3}$/.test(c.currency)
      )
        fail(
          "google_stage2_inherit_not_public",
          "Снять CPC override можно только новым inverse preview по VERIFIED commit, не прямым typed/raw clear.",
        );
      const p = record(c.proof);
      if (
        Object.keys(p).sort().join(",") !==
          "campaign_resource_name,effective_cpc_bid_micros,parent_cpc_bid_micros,parent_resource_name,source" ||
        p.source !== "AD_GROUP" ||
        typeof p.effective_cpc_bid_micros !== "string" ||
        typeof p.parent_cpc_bid_micros !== "string" ||
        !/^[1-9][0-9]{0,15}$/.test(String(p.effective_cpc_bid_micros)) ||
        p.parent_cpc_bid_micros !== p.effective_cpc_bid_micros ||
        typeof p.parent_resource_name !== "string" ||
        !/^customers\/[0-9]{10}\/adGroups\/[0-9]{1,20}$/.test(
          p.parent_resource_name,
        ) ||
        typeof p.campaign_resource_name !== "string" ||
        !/^customers\/[0-9]{10}\/campaigns\/[0-9]{1,20}$/.test(
          p.campaign_resource_name,
        )
      )
        fail(
          "google_stage2_inherited_proof_invalid",
          "Inherited inverse требует точный server-recorded source/effective/parent proof, не выдуманную ставку.",
        );
    } else {
      if (
        !["absolute", "percent"].includes(String(c.mode)) ||
        typeof c.currency !== "string" ||
        !/^[A-Z]{3}$/.test(c.currency) ||
        Object.keys(c).some(
          (k) =>
            !(
              c.mode === "absolute"
                ? ["mode", "amount", "currency"]
                : ["mode", "percent", "currency"]
            ).includes(k),
        ) ||
        (c.mode === "absolute" &&
          (typeof c.amount !== "string" ||
            !/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,6})?$/.test(c.amount))) ||
        (c.mode === "percent" &&
          (typeof c.percent !== "string" ||
            !/^-?(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,4})?$/.test(c.percent)))
      )
        fail(
          "google_stage2_change_invalid",
          "Change: absolute amount либо percent (decimal string), currency ISO; не raw micros.",
        );
    }
    const key =
      field +
      ":" +
      x.campaign_id +
      ":" +
      (x.ad_group_id ?? "") +
      ":" +
      (x.criterion_id ?? "");
    if (seen.has(key))
      fail(
        "google_stage2_duplicate",
        "Один объект/поле нельзя обновлять дважды в batch.",
      );
    seen.add(key);
    return x as unknown as Stage2Item;
  });
  if (
    r.action === "bid_budget_inherited_rollback" &&
    !items.some((i) => i.change.mode === "inherit")
  )
    fail(
      "google_stage2_inherited_proof_invalid",
      "Internal inherited inverse должен содержать доказанное снятие override.",
    );
  return { action: r.action as Stage2Intent["action"], items };
}
export function changedMicros(
  current: string,
  change: Stage2Change,
  currency: string,
  unit?: GoogleMoneyUnit,
): string {
  if (change.currency !== currency)
    fail(
      "google_currency_mismatch",
      "Валюта change должна совпадать с валютой аккаунта; FX conversion не выполняется.",
    );
  if (unit && unit.currency !== currency)
    fail(
      "google_currency_unit_mismatch",
      "Currency unit не совпадает с валютой аккаунта.",
    );
  if (change.mode === "inherit")
    fail(
      "google_stage2_inherit_not_public",
      "Inherited inverse не является положительной денежной суммой или процентом.",
    );
  if (change.mode === "absolute") {
    const micros = currencyMicros(change.amount, change.currency, currency);
    return unit ? quantizePositiveMicros(micros, unit) : micros;
  }
  if (!/^[0-9]+$/.test(current) || BigInt(current) <= 0n)
    fail(
      "google_stage2_percent_base_unavailable",
      "Процент требует положительную explicit ставку/бюджет; inherited/нулевой override не подменяется effective bid.",
    );
  const negative = change.percent.startsWith("-"),
    [whole, fraction = ""] = change.percent.replace(/^-/u, "").split("."),
    p = BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0")),
    signed = negative ? -p : p;
  if (signed <= -1000000n || signed > 10000000n)
    fail(
      "google_stage2_percent_invalid",
      "Допустимый percent: больше -100% и не более +1000%.",
    );
  const numerator = BigInt(current) * (1000000n + signed);
  if (unit)
    return quantizePositiveMicros(numerator.toString(), unit, "1000000");
  const value = (numerator + 500000n) / 1000000n;
  if (value <= 0n || value > 9999999999999999n)
    fail(
      "google_stage2_amount_invalid",
      "Полученная денежная сумма вне допустимого диапазона.",
    );
  return value.toString();
}
export async function stage2CheckedRead(read: Stage1Reader, query: string) {
  const rows = await read(query);
  if (rows.length > 5000)
    fail(
      "google_inventory_limit",
      "Inventory превышает 5000 строк; данные не обрезаны.",
    );
  return rows
    .map(record)
    .sort((a, b) => canonical(a).localeCompare(canonical(b), "en"));
}
export async function rereadStage2Checks(plan: Stage2Plan, read: Stage1Reader) {
  const result = [];
  for (const c of plan.checks)
    result.push({
      query: c.query,
      rows: await stage2CheckedRead(read, c.query),
    });
  return result;
}
const campaignSelect =
  "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign.bidding_strategy_type, campaign.bidding_strategy, campaign.maximize_conversions.target_cpa_micros FROM campaign";
function normalizedEntity(row: Row, key: string, includeEffective = true) {
  const entity = { ...record(row[key]) };
  if (key === "adGroupCriterion" && !includeEffective) {
    delete entity.effectiveCpcBidMicros;
    delete entity.effectiveCpcBidSource;
  }
  for (const field of key === "campaignBudget"
    ? ["amountMicros"]
    : key === "adGroup"
      ? ["cpcBidMicros", "targetCpaMicros"]
      : ["cpcBidMicros"])
    if (
      key === "adGroupCriterion" &&
      field === "cpcBidMicros" &&
      entity[field] === undefined
    ) {
      if (
        entity.effectiveCpcBidSource === "AD_GROUP" &&
        /^[1-9][0-9]*$/.test(String(entity.effectiveCpcBidMicros))
      )
        entity[field] = "0";
    } else
      entity[field] =
        key === "adGroupCriterion"
          ? String(entity[field])
          : String(entity[field] ?? "0");
  if (key === "adGroupCriterion" && entity.effectiveCpcBidMicros !== undefined)
    entity.effectiveCpcBidMicros = String(entity.effectiveCpcBidMicros);
  return entity;
}
const keywordCampaignSelect = campaignSelect.replace(
  "campaign.id,",
  "campaign.id, campaign.advertising_channel_type,",
);
const groupCpcSelect =
  "SELECT campaign.id, ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ad_group.target_cpa_micros FROM ad_group";
function sameInheritedProof(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
function cpcProof(
  before: Row,
  campaign: Row,
  parent: Row,
): Stage2InheritedCpcProof | undefined {
  if (
    before.cpcBidMicros !== "0" ||
    before.effectiveCpcBidSource !== "AD_GROUP" ||
    !/^[1-9][0-9]{0,15}$/.test(String(before.effectiveCpcBidMicros)) ||
    campaign.advertisingChannelType !== "SEARCH" ||
    campaign.biddingStrategyType !== "MANUAL_CPC" ||
    campaign.biddingStrategy ||
    campaign.status === "REMOVED" ||
    String(parent.cpcBidMicros) !== before.effectiveCpcBidMicros ||
    parent.status === "REMOVED"
  )
    return undefined;
  return {
    source: "AD_GROUP",
    effective_cpc_bid_micros: String(before.effectiveCpcBidMicros),
    parent_resource_name: String(parent.resourceName),
    parent_cpc_bid_micros: String(parent.cpcBidMicros),
    campaign_resource_name: String(campaign.resourceName),
  };
}
/** Narrow v2/v5 comparison: missing/zero CPC is inherited only with exact provider source/effective proof. */
export function stage2CpcVerificationEntity(
  actual: Row,
  expected: Row,
): Row | null {
  const result = { ...actual };
  if (result.cpcBidMicros !== undefined)
    result.cpcBidMicros = String(result.cpcBidMicros);
  if (result.effectiveCpcBidMicros !== undefined)
    result.effectiveCpcBidMicros = String(result.effectiveCpcBidMicros);
  if (expected.cpcBidMicros === "0") {
    if (
      expected.effectiveCpcBidSource !== "AD_GROUP" ||
      !/^[1-9][0-9]{0,15}$/.test(String(expected.effectiveCpcBidMicros)) ||
      result.effectiveCpcBidSource !== "AD_GROUP" ||
      result.effectiveCpcBidMicros !== expected.effectiveCpcBidMicros ||
      ![undefined, "0"].includes(result.cpcBidMicros as string | undefined)
    )
      return null;
    result.cpcBidMicros = "0";
  }
  return result;
}
function resourceOwner(resource: unknown, account: string, kind: string) {
  if (
    typeof resource !== "string" ||
    !new RegExp(
      `^customers/${account}/${kind}/[0-9]{1,20}(?:~[0-9]{1,20})?$`,
    ).test(resource)
  )
    fail(
      "google_stage2_ownership_invalid",
      "Provider resource не принадлежит выбранному customer. Вся пачка отклонена.",
    );
}
export async function buildStage2Plan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
): Promise<Stage2Plan> {
  const account_id = customerId(account),
    intent = parseStage2Intent(raw),
    checks: Stage2Plan["checks"] = [],
    cache = new Map<string, Row[]>();
  const query = async (q: string) => {
    if (!cache.has(q)) {
      const rows = await stage2CheckedRead(read, q);
      cache.set(q, rows);
      checks.push({ query: q, rows });
    }
    return cache.get(q)!;
  };
  const customers = await query(
    "SELECT customer.id, customer.currency_code FROM customer",
  );
  if (
    customers.length !== 1 ||
    String(record(customers[0]!.customer).id) !== account_id ||
    !/^[A-Z]{3}$/.test(String(record(customers[0]!.customer).currencyCode))
  )
    fail(
      "google_stage2_account_invalid",
      "Нельзя доказать customer/currency выбранного аккаунта.",
    );
  const currency = String(record(customers[0]!.customer).currencyCode),
    unit = await resolveGoogleMoneyUnit(currency, query),
    operations: Stage2Operation[] = [],
    items: Stage2Plan["items"] = [],
    touched = new Set<string>();
  for (const [index, item] of intent.items.entries()) {
    const display: Stage2Plan["items"][number] = {
      item: index,
      keyword: item.field,
      campaign_id: item.campaign_id,
      campaign_name: "",
      ad_group_id: item.ad_group_id ?? "",
      ad_group_name: "",
      before: null,
      after: null,
      warnings: [],
      conflicts: [],
      duplicate_status: "none",
      provider_operations: [],
    };
    items.push(display);
    try {
      const parents = await query(
        (item.field === "keyword_cpc"
          ? keywordCampaignSelect
          : campaignSelect) + ` WHERE campaign.id = ${item.campaign_id}`,
      );
      if (parents.length !== 1)
        fail(
          "google_stage2_object_unavailable",
          "Campaign не найдена однозначно в выбранном account.",
        );
      const campaign = record(parents[0]!.campaign);
      resourceOwner(campaign.resourceName, account_id, "campaigns");
      if (String(campaign.id) !== item.campaign_id)
        fail(
          "google_stage2_ownership_invalid",
          "Campaign ID не совпадает с provider snapshot.",
        );
      if (campaign.status === "REMOVED")
        fail(
          "google_stage2_object_unavailable",
          "Удалённая campaign не изменяется.",
        );
      display.campaign_name = String(campaign.name ?? "");
      let kind: Stage2Operation["kind"],
        key: string,
        select: string,
        where: string,
        providerField: string,
        mask: string;
      if (item.field === "campaign_daily_budget") {
        resourceOwner(campaign.campaignBudget, account_id, "campaignBudgets");
        kind = "campaignBudgets";
        key = "campaignBudget";
        providerField = "amountMicros";
        mask = "amount_micros";
        select =
          "SELECT campaign_budget.resource_name, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.delivery_method, campaign_budget.period FROM campaign_budget";
        where = `campaign_budget.resource_name = '${campaign.campaignBudget}'`;
      } else if (item.field === "keyword_cpc") {
        kind = "adGroupCriteria";
        key = "adGroupCriterion";
        providerField = "cpcBidMicros";
        mask = "cpc_bid_micros";
        const manualSearch =
          campaign.advertisingChannelType === "SEARCH" &&
          campaign.biddingStrategyType === "MANUAL_CPC" &&
          !campaign.biddingStrategy;
        select =
          "SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.type, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.cpc_bid_micros" +
          (manualSearch
            ? ", ad_group_criterion.effective_cpc_bid_micros, ad_group_criterion.effective_cpc_bid_source"
            : "") +
          " FROM ad_group_criterion";
        where = `campaign.id = ${item.campaign_id} AND ad_group.id = ${item.ad_group_id} AND ad_group_criterion.criterion_id = ${item.criterion_id}`;
      } else {
        kind = "adGroups";
        key = "adGroup";
        providerField =
          item.field === "ad_group_cpc" ? "cpcBidMicros" : "targetCpaMicros";
        mask =
          item.field === "ad_group_cpc"
            ? "cpc_bid_micros"
            : "target_cpa_micros";
        select = groupCpcSelect;
        where = `campaign.id = ${item.campaign_id} AND ad_group.id = ${item.ad_group_id}`;
      }
      const q = select + " WHERE " + where,
        rows = await query(q);
      if (rows.length !== 1)
        fail(
          "google_stage2_object_unavailable",
          "Bid/budget объект отсутствует или не принадлежит campaign/ad group.",
        );
      const before = normalizedEntity(
        rows[0]!,
        key,
        q.includes("ad_group_criterion.effective_cpc_bid_source"),
      );
      resourceOwner(before.resourceName, account_id, kind);
      const expectedResource =
        kind === "adGroupCriteria"
          ? `customers/${account_id}/adGroupCriteria/${item.ad_group_id}~${item.criterion_id}`
          : kind === "adGroups"
            ? `customers/${account_id}/adGroups/${item.ad_group_id}`
            : String(campaign.campaignBudget);
      if (
        before.resourceName !== expectedResource ||
        (kind !== "campaignBudgets" &&
          String(record(rows[0]!.campaign).id) !== item.campaign_id) ||
        (kind === "adGroupCriteria" &&
          String(record(rows[0]!.adGroup).id) !== item.ad_group_id)
      )
        fail(
          "google_stage2_ownership_invalid",
          "Resource/parent identity не совпадает; вся пачка отклонена.",
        );
      if (
        before.status === "REMOVED" ||
        (kind === "adGroupCriteria" &&
          (before.negative === true || before.type !== "KEYWORD"))
      )
        fail(
          "google_stage2_object_unavailable",
          "Требуется существующий positive keyword/ad group, не REMOVED.",
        );
      if (kind === "campaignBudgets") {
        if (before.period !== "DAILY")
          fail(
            "google_stage2_budget_period_unsupported",
            "Stage 2 foundation изменяет только DAILY budget, не total/custom-period budget.",
          );
        const impact = await query(
          campaignSelect +
            ` WHERE campaign.campaign_budget = '${before.resourceName}' AND campaign.status != REMOVED`,
        );
        for (const row of impact)
          resourceOwner(
            record(row.campaign).resourceName,
            account_id,
            "campaigns",
          );
        if (
          !impact.some(
            (r) => String(record(r.campaign).id) === item.campaign_id,
          ) ||
          (!before.explicitlyShared && impact.length !== 1)
        )
          fail(
            "google_stage2_ownership_invalid",
            "Budget association не подтверждена или non-shared budget связан неоднозначно.",
          );
        if (before.explicitlyShared || impact.length > 1)
          display.warnings.push(
            "Shared budget: изменение затронет все campaigns: " +
              impact
                .map(
                  (r) =>
                    String(record(r.campaign).id) +
                    " " +
                    String(record(r.campaign).name),
                )
                .join(", "),
          );
      }
      if (
        item.field === "ad_group_target_cpa" &&
        (!["TARGET_CPA", "MAXIMIZE_CONVERSIONS"].includes(
          String(campaign.biddingStrategyType),
        ) ||
          (campaign.biddingStrategyType === "MAXIMIZE_CONVERSIONS" &&
            (!/^[1-9][0-9]*$/.test(
              String(
                record(campaign.maximizeConversions).targetCpaMicros ?? "0",
              ),
            ) ||
              Boolean(campaign.biddingStrategy))))
      )
        fail(
          "google_stage2_strategy_incompatible",
          "Ad group target CPA требует TARGET_CPA либо standard MAXIMIZE_CONVERSIONS с положительным campaign target CPA; portfolio MaximizeConversions пока не поддерживается. Стратегия не меняется.",
        );
      if (
        ["keyword_cpc", "ad_group_cpc"].includes(item.field) &&
        (campaign.biddingStrategyType !== "MANUAL_CPC" ||
          Boolean(campaign.biddingStrategy))
      )
        display.warnings.push(
          "Manual CPC override при automated/portfolio bidding может не влиять на фактическую ставку; стратегия не меняется.",
        );
      let inheritedBefore: Stage2InheritedCpcProof | undefined;
      let parentCpc: Row | undefined;
      if (
        item.field === "keyword_cpc" &&
        (before.effectiveCpcBidSource === "AD_GROUP" ||
          item.change.mode === "inherit")
      ) {
        const parentRows = await query(
          groupCpcSelect +
            ` WHERE campaign.id = ${item.campaign_id} AND ad_group.id = ${item.ad_group_id}`,
        );
        if (parentRows.length !== 1)
          fail(
            "google_stage2_inherited_proof_invalid",
            "Inherited parent не найден однозначно.",
          );
        parentCpc = normalizedEntity(parentRows[0]!, "adGroup");
        resourceOwner(parentCpc.resourceName, account_id, "adGroups");
        if (
          parentCpc.resourceName !==
            `customers/${account_id}/adGroups/${item.ad_group_id}` ||
          String(parentCpc.id) !== item.ad_group_id ||
          String(record(parentRows[0]!.campaign).id) !== item.campaign_id
        )
          fail(
            "google_stage2_ownership_invalid",
            "Inherited parent identity не совпадает; вся пачка отклонена.",
          );
        inheritedBefore = cpcProof(before, campaign, parentCpc);
      }
      if (item.change.mode === "inherit") {
        const proof = item.change.proof;
        resourceOwner(proof.parent_resource_name, account_id, "adGroups");
        resourceOwner(proof.campaign_resource_name, account_id, "campaigns");
        const expectedInherited = {
          ...before,
          cpcBidMicros: "0",
          effectiveCpcBidSource: "AD_GROUP",
          effectiveCpcBidMicros: proof.effective_cpc_bid_micros,
        };
        const freshProof = cpcProof(expectedInherited, campaign, parentCpc!);
        if (
          !freshProof ||
          !sameInheritedProof(proof, freshProof) ||
          !/^[1-9][0-9]{0,15}$/.test(String(before.cpcBidMicros)) ||
          before.effectiveCpcBidSource !== "AD_GROUP_CRITERION" ||
          before.effectiveCpcBidMicros !== before.cpcBidMicros ||
          item.change.currency !== currency
        )
          fail(
            "google_stage2_inherited_proof_invalid",
            "Снять override можно только при неизменных Manual Search/source/parent/currency; новый inverse preview обязателен.",
          );
        const identity = String(before.resourceName);
        if (touched.has(identity))
          fail(
            "google_stage2_duplicate_resource",
            "Повторный inherited target в batch запрещён.",
          );
        touched.add(identity);
        const operation: Stage2Operation = {
          kind,
          method: "update",
          resource_name: identity,
          fields: { resourceName: identity },
          update_mask: mask,
          before,
          expected: expectedInherited,
          inherited_after: proof,
          row: index,
          read_query: q,
          response_key: key,
        };
        display.before = {
          ...before,
          currency,
          billable_unit_micros: unit.unit_micros,
        };
        display.after = {
          ...expectedInherited,
          currency,
          billable_unit_micros: unit.unit_micros,
          cpc_override: "INHERITED",
        };
        display.keyword = String(record(before.keyword).text);
        display.warnings.push(
          "Server-recorded rollback: снять только keyword CPC override (unset + cpc_bid_micros mask); inherited AD_GROUP/effective CPC доказаны. Ни parent bid, ни status не изменяются.",
        );
        display.provider_operations = [operations.length];
        operations.push(operation);
        continue;
      }
      if (before.cpcBidMicros === undefined && item.field === "keyword_cpc")
        fail(
          "google_stage2_inherited_proof_invalid",
          "Отсутствующий keyword CPC без provider source/effective proof не подменяется нулём.",
        );
      const old = String(before[providerField]),
        next = changedMicros(old, item.change, currency, unit);
      const rawMicros = changedMicros(old, item.change, currency);
      // Preserve the original percent rational for truthful rounding warnings.
      if (item.change.mode === "percent") {
        const parts = item.change.percent.replace(/^-/, "").split("."),
          p =
            BigInt(parts[0]!) * 10000n +
            BigInt((parts[1] ?? "").padEnd(4, "0")),
          factor = 1000000n + (item.change.percent.startsWith("-") ? -p : p);
        display.warnings.push(
          ...moneyUnitWarnings(
            (BigInt(old) * factor).toString(),
            next,
            unit,
            "1000000",
          ),
        );
      } else display.warnings.push(...moneyUnitWarnings(rawMicros, next, unit));
      if (old === next)
        fail(
          "google_stage2_noop",
          "Полученная сумма уже установлена; Google mutation для no-op не создаётся.",
        );
      if (
        BigInt(old) === 0n ||
        (BigInt(next) > BigInt(old)
          ? BigInt(next) - BigInt(old)
          : BigInt(old) - BigInt(next)) *
          100n >
          BigInt(old) * 50n
      )
        display.warnings.push(
          "Изменение более 50% текущей суммы (или новый explicit override вместо inherited).",
        );
      const identity = String(before.resourceName);
      if (touched.has(identity))
        fail(
          "google_stage2_duplicate_resource",
          "Несколько строк затрагивают одно и то же resource, в том числе общий shared budget; объедините изменения или используйте отдельные previews.",
        );
      touched.add(identity);
      const operation: Stage2Operation = {
        kind,
        method: "update",
        resource_name: String(before.resourceName),
        fields: { resourceName: before.resourceName, [providerField]: next },
        update_mask: mask,
        before,
        expected: { ...before, [providerField]: next },
        ...(inheritedBefore ? { inherited_before: inheritedBefore } : {}),
        row: index,
        read_query: q,
        response_key: key,
      };
      if (
        item.field === "keyword_cpc" &&
        campaign.biddingStrategyType === "MANUAL_CPC" &&
        !campaign.biddingStrategy &&
        (before.effectiveCpcBidSource !== undefined ||
          before.effectiveCpcBidMicros !== undefined)
      ) {
        operation.expected.effectiveCpcBidSource = "AD_GROUP_CRITERION";
        operation.expected.effectiveCpcBidMicros = next;
      }
      if (
        item.field === "keyword_cpc" &&
        before.cpcBidMicros === "0" &&
        !inheritedBefore
      )
        display.warnings.push(
          "Inherited rollback unsupported: прежний source/parent не доказан; effective bid не угадывается.",
        );
      display.before = {
        ...before,
        currency,
        billable_unit_micros: unit.unit_micros,
      };
      display.after = {
        ...operation.expected,
        currency,
        billable_unit_micros: unit.unit_micros,
      };
      if (before.keyword) display.keyword = String(record(before.keyword).text);
      display.provider_operations = [operations.length];
      operations.push(operation);
    } catch (e) {
      if (
        !(e instanceof GoogleAdsWriteError) ||
        [
          "google_stage2_ownership_invalid",
          "google_stage2_duplicate_resource",
          "google_inventory_limit",
        ].includes(e.writeCode)
      )
        throw e;
      display.row_error = {
        source: "HOLYMEDIA",
        code: e.writeCode,
        message: e.message,
      };
      display.warnings.push(e.message);
    }
  }
  if (!operations.length)
    fail(
      "google_stage2_no_eligible_rows",
      "Все строки отклонены/no-op; preview не создан, provider mutation не выполняется.",
    );
  return { version: 2, account_id, intent, checks, operations, items };
}
export function assertStage2Plan(plan: Stage2Plan, account: string) {
  if (
    plan.version !== 2 ||
    plan.account_id !== customerId(account) ||
    !["bid_budget_update", "bid_budget_inherited_rollback"].includes(
      plan.intent.action,
    ) ||
    !plan.operations.length ||
    plan.operations.length > 500
  )
    fail("google_stage2_plan_invalid", "Некорректный Stage 2 immutable plan.");
  parseStage2Intent(plan.intent);
  for (const o of plan.operations) {
    resourceOwner(o.resource_name, plan.account_id, o.kind);
    const original = plan.intent.items[o.row];
    if (
      !original ||
      o.before.resourceName !== o.resource_name ||
      o.expected.resourceName !== o.resource_name
    )
      fail(
        "google_stage2_plan_invalid",
        "Immutable inverse должен сохранять exact resource/row identity.",
      );
    if (o.inherited_before) {
      const proof = frozenInheritedProof(plan, original, o.before);
      if (!proof || !sameInheritedProof(proof, o.inherited_before))
        fail(
          "google_stage2_plan_invalid",
          "Inherited BEFORE proof должен совпадать с frozen provider/parent checks.",
        );
    }
    if (original.change.mode === "inherit") {
      const proof = frozenInheritedProof(plan, original, o.expected);
      const expected = {
        ...o.before,
        cpcBidMicros: "0",
        effectiveCpcBidSource: "AD_GROUP",
        effectiveCpcBidMicros: original.change.proof.effective_cpc_bid_micros,
      };
      if (
        plan.intent.action !== "bid_budget_inherited_rollback" ||
        original.field !== "keyword_cpc" ||
        o.kind !== "adGroupCriteria" ||
        o.method !== "update" ||
        o.resource_name !==
          `customers/${plan.account_id}/adGroupCriteria/${original.ad_group_id}~${original.criterion_id}` ||
        o.update_mask !== "cpc_bid_micros" ||
        canonical(o.fields) !== canonical({ resourceName: o.resource_name }) ||
        !proof ||
        !sameInheritedProof(proof, original.change.proof) ||
        !sameInheritedProof(proof, o.inherited_after) ||
        !/^[1-9][0-9]{0,15}$/.test(String(o.before.cpcBidMicros)) ||
        o.before.effectiveCpcBidSource !== "AD_GROUP_CRITERION" ||
        o.before.effectiveCpcBidMicros !== o.before.cpcBidMicros ||
        canonical(o.expected) !== canonical(expected)
      )
        fail(
          "google_stage2_plan_invalid",
          "Clear inverse меняет только unset keyword CPC с server-recorded source/effective/parent proof.",
        );
      continue;
    }
    if (o.inherited_after)
      fail(
        "google_stage2_plan_invalid",
        "Inherited AFTER proof разрешён только exact inherited inverse.",
      );
    const pair =
      o.kind === "campaignBudgets"
        ? ["amount_micros", "amountMicros"]
        : o.kind === "adGroups" && o.update_mask === "target_cpa_micros"
          ? ["target_cpa_micros", "targetCpaMicros"]
          : ["cpc_bid_micros", "cpcBidMicros"];
    if (
      !["adGroupCriteria", "adGroups", "campaignBudgets"].includes(o.kind) ||
      o.method !== "update" ||
      o.update_mask !== pair[0] ||
      o.fields.resourceName !== o.resource_name ||
      canonical(Object.keys(o.fields).sort()) !==
        canonical(["resourceName", pair[1]!].sort()) ||
      typeof o.fields[pair[1]!] !== "string" ||
      !/^[1-9][0-9]{0,15}$/.test(String(o.fields[pair[1]!])) ||
      o.expected[pair[1]!] !== o.fields[pair[1]!]
    )
      fail(
        "google_stage2_plan_invalid",
        "Plan может менять только approved bid/budget field, без создания/status/foreign resource.",
      );
  }
}
function frozenInheritedProof(
  plan: Stage2Plan,
  item: Stage2Item,
  entity: Row,
): Stage2InheritedCpcProof | undefined {
  if (item.field !== "keyword_cpc") return undefined;
  const campaignRows = plan.checks.find(
    (c) =>
      c.query ===
      keywordCampaignSelect + ` WHERE campaign.id = ${item.campaign_id}`,
  )?.rows;
  const parentRows = plan.checks.find(
    (c) =>
      c.query ===
      groupCpcSelect +
        ` WHERE campaign.id = ${item.campaign_id} AND ad_group.id = ${item.ad_group_id}`,
  )?.rows;
  const customerRows = plan.checks.find(
    (c) =>
      c.query === "SELECT customer.id, customer.currency_code FROM customer",
  )?.rows;
  if (
    campaignRows?.length !== 1 ||
    parentRows?.length !== 1 ||
    customerRows?.length !== 1 ||
    record(customerRows[0]!.customer).currencyCode !== item.change.currency ||
    String(record(customerRows[0]!.customer).id) !== plan.account_id
  )
    return undefined;
  const campaign = record(campaignRows[0]!.campaign),
    parent = normalizedEntity(parentRows[0]!, "adGroup");
  if (
    campaign.resourceName !==
      `customers/${plan.account_id}/campaigns/${item.campaign_id}` ||
    String(campaign.id) !== item.campaign_id ||
    parent.resourceName !==
      `customers/${plan.account_id}/adGroups/${item.ad_group_id}` ||
    String(parent.id) !== item.ad_group_id ||
    String(record(parentRows[0]!.campaign).id) !== item.campaign_id ||
    parent.status === "REMOVED"
  )
    return undefined;
  return cpcProof(entity, campaign, parent);
}
export async function verifyStage2Mutation(
  plan: Stage2Plan,
  results: Stage1MutationResult[],
  read: Stage1Reader,
) {
  // Reread unchanged account/parent/consumer context as well as mutated fields.
  // A budget value alone cannot prove the expected campaign association survived.
  let contextVerified = true;
  for (const check of plan.checks.filter(
    (c) => !plan.operations.some((o) => o.read_query === c.query),
  )) {
    try {
      if (
        canonical(await stage2CheckedRead(read, check.query)) !==
        canonical(check.rows)
      )
        contextVerified = false;
    } catch {
      contextVerified = false;
    }
  }
  const actual: (Row | null)[] = [],
    ops: {
      operation: number;
      resource_name: string;
      success: boolean;
      before: Row;
      requested: Row;
      actual: Row | null;
      error: ReturnType<typeof googleWriteFailure> | null;
    }[] = [];
  for (const [i, o] of plan.operations.entries()) {
    let state: Row | null = null;
    try {
      const rows = await stage2CheckedRead(read, o.read_query);
      if (rows.length === 1) {
        state = normalizedEntity(
          rows[0]!,
          o.response_key,
          o.read_query.includes("ad_group_criterion.effective_cpc_bid_source"),
        );
        resourceOwner(state.resourceName, plan.account_id, o.kind);
        if (
          o.kind === "adGroupCriteria" &&
          o.update_mask === "cpc_bid_micros" &&
          o.expected.effectiveCpcBidSource !== undefined
        )
          state = stage2CpcVerificationEntity(state, o.expected);
      }
    } catch {
      /* Uncertain read never proves a write or triggers a mutation retry. */
    }
    actual.push(state);
    const success =
      contextVerified &&
      results[i]?.success === true &&
      Boolean(state) &&
      canonical(state) === canonical(o.expected);
    ops.push({
      operation: i,
      resource_name: o.resource_name,
      success,
      before: o.before,
      requested: o.expected,
      actual: state,
      error: success
        ? null
        : (results[i]?.error ??
          googleWriteFailure(
            state ? "VERIFICATION_MISMATCH" : "OUTCOME_UNCERTAIN",
          )),
    });
  }
  const items = plan.items.map((item) => {
    const operations = item.provider_operations.map((i) => ops[i]!);
    const success =
      !item.row_error &&
      operations.length > 0 &&
      operations.every((x) => x.success);
    return {
      ...item,
      operations,
      success,
      result: success ? "success" : "failure",
    };
  });
  return {
    context_verified: contextVerified,
    items,
    actual,
    status: items.every((i) => i.success)
      ? "VERIFIED"
      : items.some((i) => i.success)
        ? "PARTIAL_FAILURE"
        : "NOT_VERIFIED",
  };
}
export function stage2RollbackIntent(
  plan: Stage2Plan,
  indices: number[],
  currency: string,
): Stage2Intent {
  assertStage2Plan(plan, plan.account_id);
  if (
    !indices.length ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= plan.operations.length,
    )
  )
    fail(
      "rollback_unsupported",
      "Rollback требует уникальные recorded successful operation indices.",
    );
  const constant = plan.checks.find(
    (c) => c.query === currencyConstantQuery(currency),
  );
  const unit = constant
    ? moneyUnitFromRows(currency, constant.rows)
    : undefined;
  const items = indices.map((i) => {
    const op = plan.operations[i]!,
      original = plan.intent.items[op.row]!,
      field =
        op.update_mask === "amount_micros"
          ? "amountMicros"
          : op.update_mask === "target_cpa_micros"
            ? "targetCpaMicros"
            : "cpcBidMicros",
      old = String(op.before[field]);
    if (
      original.field === "keyword_cpc" &&
      old === "0" &&
      op.inherited_before
    ) {
      if (original.change.currency !== currency)
        fail(
          "rollback_unsupported",
          "Inherited rollback currency должна совпадать с исходным account.",
        );
      return {
        ...original,
        change: {
          mode: "inherit" as const,
          currency,
          proof: structuredClone(op.inherited_before),
        },
      };
    }
    if (!/^[1-9][0-9]*$/.test(old))
      fail(
        "rollback_unsupported",
        "Inherited/zero override без provider-proven source/effective/parent нельзя безопасно восстановить; effective bid не угадывается.",
      );
    const n = BigInt(old);
    if (unit && !alignedMoneyMicros(old, unit))
      fail(
        "rollback_unsupported",
        "Прежняя сумма не выровнена по доказанной billable unit; exact rollback не обещается и не округляется скрыто.",
      );
    return {
      ...original,
      change: {
        mode: "absolute" as const,
        amount:
          (n / 1000000n).toString() +
          "." +
          (n % 1000000n).toString().padStart(6, "0"),
        currency,
      },
    };
  });
  return {
    action: items.some((i) => i.change.mode === "inherit")
      ? "bid_budget_inherited_rollback"
      : "bid_budget_update",
    items,
  };
}
