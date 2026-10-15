import type { AppConfig } from "@holymedia/config";
import {
  extContext,
  extFail,
  extItem,
  extQuote,
  extRow,
  type ExtendedPlan,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";
import type { Stage1Reader } from "./google-ads-stage1.js";

const ACCOUNT = "8590146099";
const ORIGIN = "https://mcp-test.holymedia.kz";
const SELF = `customers/${ACCOUNT}`;
const BASE_CUSTOMER_QUERY =
  "SELECT customer.id, customer.resource_name, customer.currency_code, customer.time_zone FROM customer";
const CONVERSION_CUSTOMER_QUERY =
  "SELECT customer.id, customer.resource_name, customer.test_account, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer";
const actionQuery = (name: string) =>
  `SELECT conversion_action.resource_name, conversion_action.name, conversion_action.type, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal, conversion_action.counting_type, conversion_action.owner_customer FROM conversion_action WHERE conversion_action.name = ${extQuote(name)}`;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function isolated(config: AppConfig, account: string): boolean {
  return (
    config.qrsTestConversionActionConfirmedWriteEnabled &&
    config.qrsTestRestrictedAuth &&
    !config.qrsTestGoogleConfirmedWriteEnabled &&
    !config.qrsTestCloneConfirmedWriteEnabled &&
    !config.qrsTestPmaxConfirmedWriteEnabled &&
    config.providerGoogleAdsWriteEnabled &&
    config.previewOnly &&
    !config.confirmedWriteEnabled &&
    !config.providerGoogleAdsStage2WriteEnabled &&
    !config.providerGoogleAdsStage3WriteEnabled &&
    !config.providerGoogleAdsStage4WriteEnabled &&
    !config.publicMcpWriteScopeEnabled &&
    !config.publicMcpControlledWriteEnabled &&
    config.publicBaseUrl === ORIGIN &&
    config.providerGoogleApiVersion.replace(/^v/, "") === "24" &&
    account.replaceAll("-", "") === ACCOUNT &&
    config.googleAdsWriteAccountAllowlist.length === 1 &&
    config.googleAdsWriteAccountAllowlist[0] === ACCOUNT &&
    /^HM_MCP_TEST_SIGNUP_[A-Z0-9_]{8,60}$/.test(
      config.qrsTestConversionActionName ?? "",
    )
  );
}

/** Before build: exact one-name input, no arbitrary Google fields. */
export function qrsConversionActionIntentAllowed(
  config: AppConfig,
  account: string,
  input: unknown,
): boolean {
  if (!isolated(config, account)) return false;
  const intent = object(input);
  const items = intent.items;
  return (
    intent.action === "conversion_action_create" &&
    (intent.account_id === undefined ||
      String(intent.account_id).replaceAll("-", "") === ACCOUNT) &&
    (intent.provider === undefined || intent.provider === "GOOGLE_ADS") &&
    Array.isArray(items) &&
    items.length === 1 &&
    Object.keys(object(items[0])).length === 1 &&
    Object.hasOwn(object(items[0]), "name") &&
    object(items[0]).name === config.qrsTestConversionActionName
  );
}

/** Rechecked against the frozen plan in preview-service and lower adapter. */
export function qrsConversionActionWriteAllowed(
  config: AppConfig,
  input: unknown,
): input is ExtendedPlan {
  const plan = object(input);
  if (
    !isolated(config, String(plan.account_id ?? "")) ||
    plan.version !== 4 ||
    !qrsConversionActionIntentAllowed(config, ACCOUNT, plan.intent) ||
    plan.atomic !== true ||
    plan.irreversible !== true ||
    !Array.isArray(plan.operations) ||
    plan.operations.length !== 1 ||
    !Array.isArray(plan.items) ||
    plan.items.length !== 1 ||
    !Array.isArray(plan.checks) ||
    plan.checks.length !== 3
  )
    return false;
  const name = config.qrsTestConversionActionName!;
  const operation = object(plan.operations[0]);
  const fields = object(operation.fields);
  const expected = object(operation.expected);
  const checks = plan.checks.map(object);
  const base = checks.find((check) => check.query === BASE_CUSTOMER_QUERY);
  const customer = checks.find(
    (check) => check.query === CONVERSION_CUSTOMER_QUERY,
  );
  const nameCheck = checks.find((check) => check.query === actionQuery(name));
  const rows = customer?.rows;
  const proof = Array.isArray(rows) ? object(object(rows[0]).customer) : {};
  return (
    Boolean(base && customer && nameCheck) &&
    Array.isArray(nameCheck?.rows) &&
    nameCheck.rows.length === 0 &&
    Array.isArray(rows) &&
    rows.length === 1 &&
    String(proof.id) === ACCOUNT &&
    proof.resourceName === SELF &&
    proof.testAccount === true &&
    object(proof.conversionTrackingSetting).googleAdsConversionCustomer ===
      SELF &&
    operation.kind === "conversionActions" &&
    operation.method === "create" &&
    operation.resource_name === null &&
    operation.update_mask === null &&
    operation.before === null &&
    operation.row === 0 &&
    operation.response_key === "conversionAction" &&
    operation.read_query === actionQuery(name) &&
    Object.keys(fields).sort().join(",") ===
      "category,countingType,name,primaryForGoal,status,type" &&
    fields.name === name &&
    fields.type === "WEBPAGE" &&
    fields.category === "SIGNUP" &&
    fields.status === "ENABLED" &&
    fields.primaryForGoal === true &&
    fields.countingType === "ONE_PER_CLICK" &&
    expected.ownerCustomer === SELF &&
    Object.entries(fields).every(([key, value]) => expected[key] === value)
  );
}

export async function buildConversionActionPlan(
  account: string,
  raw: ExtendedRow & { action: string; items: ExtendedRow[] },
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  const ctx = await extContext(account, read);
  if (ctx.account_id !== ACCOUNT || raw.items.length !== 1)
    extFail(
      "google_conversion_test_account_denied",
      "Only one TEST action is supported.",
    );
  const name = raw.items[0]?.name;
  if (
    typeof name !== "string" ||
    !/^HM_MCP_TEST_SIGNUP_[A-Z0-9_]{8,60}$/.test(name)
  )
    extFail(
      "google_conversion_name_invalid",
      "Only a unique TEST SIGNUP name is supported.",
    );
  const proofRows = await ctx.query(CONVERSION_CUSTOMER_QUERY);
  const proof = extRow(proofRows[0]?.customer);
  if (
    proofRows.length !== 1 ||
    String(proof.id) !== ACCOUNT ||
    proof.resourceName !== SELF ||
    proof.testAccount !== true ||
    extRow(proof.conversionTrackingSetting).googleAdsConversionCustomer !== SELF
  )
    extFail(
      "google_conversion_customer_unproven",
      "TEST conversion customer must be the same owned customer.",
    );
  const existing = await ctx.query(actionQuery(name));
  if (existing.length)
    extFail(
      "google_conversion_name_taken",
      "This TEST ConversionAction name already exists.",
    );
  const fields = {
    name,
    type: "WEBPAGE",
    category: "SIGNUP",
    status: "ENABLED",
    primaryForGoal: true,
    countingType: "ONE_PER_CLICK",
  } as const;
  const item = extItem(0, name);
  item.after = fields;
  item.provider_operations.push(0);
  item.warnings.push(
    "Configuration only: actual first-party sign_up tracking has not been observed.",
  );
  return {
    version: 4,
    account_id: ACCOUNT,
    intent: raw,
    checks: ctx.checks,
    operations: [
      {
        kind: "conversionActions",
        method: "create",
        resource_name: null,
        fields: { ...fields },
        update_mask: null,
        before: null,
        expected: { ...fields, ownerCustomer: SELF },
        row: 0,
        read_query: actionQuery(name),
        response_key: "conversionAction",
      },
    ],
    items: [item],
    atomic: true,
    irreversible: true,
  };
}
