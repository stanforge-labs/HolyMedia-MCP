import { describe, expect, it, vi } from "vitest";
import { McpService } from "./mcp.service.js";
import { GoogleAdsWriteError } from "../providers/google-ads-write.js";
import {
  GOOGLE_WRITE_PROFILE_TOOLS,
  googleWriteProfileInputSchema,
  googleWriteToolProfile,
  googleWriteOpenApi,
  validateGoogleWriteProfileArguments,
} from "./google-write-client-contract.js";

type Row = Record<string, unknown>;
const account = { provider: "GOOGLE_ADS", account_id: "8590146099" };
const campaign = { ...account, campaign_id: "24324170853" };
const samples: Record<string, Row> = {
  list_accounts: { provider: "GOOGLE_ADS" },
  get_provider_capabilities: { provider: "GOOGLE_ADS" },
  list_campaigns: {
    ...account,
    start_date: "2026-10-01",
    end_date: "2026-10-09",
    limit: 100,
    statuses: ["PAUSED"],
  },
  get_campaign: campaign,
  get_campaign_structure: campaign,
  get_account_status: account,
  get_account_object: account,
  list_account_objects: { ...account, limit: 100 },
  get_launch_checklist: campaign,
  get_google_ads_detailed_report: {
    ...account,
    report_type: "campaign_performance",
    limit: 100,
  },
  google_ads_list_keywords: {
    ...account,
    since: "2026-10-01",
    until: "2026-10-09",
    statuses: ["ENABLED"],
  },
  google_ads_search_terms: {
    ...account,
    since: "2026-10-01",
    until: "2026-10-09",
    format: "json",
    contains: "test",
    only_not_added: true,
  },
  google_ads_list_negatives: {
    ...account,
    levels: ["campaign", "shared_list"],
    campaign_ids: ["24324170853"],
  },
  google_ads_check_negative_conflicts: {
    ...account,
    campaign_ids: ["24324170853"],
    negatives: [{ text: "test", match_type: "EXACT" }],
  },
  google_ads_audience_search: { ...account, name: "test", kind: "IN_MARKET" },
  list_change_journal: {
    ...account,
    from: "2026-10-01T00:00:00Z",
    to: "2026-10-09T23:59:59Z",
    limit: 50,
  },
};
function closed(schema: Row, path = "schema") {
  expect(
    schema.additionalProperties,
    `${path} never opens arbitrary fields`,
  ).not.toBe(true);
  if (
    schema.type === "object" ||
    (Array.isArray(schema.type) && schema.type.includes("object"))
  )
    expect(schema.additionalProperties, `${path} typed object closed`).toBe(
      false,
    );
  const properties = schema.properties as Record<string, Row> | undefined;
  if (properties)
    for (const [key, value] of Object.entries(properties))
      closed(value, `${path}.${key}`);
  if (schema.items) closed(schema.items as Row, `${path}[]`);
  for (const key of ["oneOf", "anyOf", "allOf"])
    if (Array.isArray(schema[key]))
      for (const [i, value] of (schema[key] as Row[]).entries())
        closed(value, `${path}.${key}[${i}]`);
  for (const key of ["if", "then", "else", "not"])
    if (schema[key]) closed(schema[key] as Row, `${path}.${key}`);
}
const error = (name: string, args: unknown) => {
  try {
    validateGoogleWriteProfileArguments(name, args);
    throw new Error("Expected rejection");
  } catch (e) {
    expect(e).toBeInstanceOf(GoogleAdsWriteError);
    const result = e as GoogleAdsWriteError;
    expect(result.failures).toEqual([]);
    expect(result.writeCode).toBe("google_client_arguments_invalid");
    return result;
  }
};

describe("Google-only closed client profile: actual registry, no provider calls", () => {
  it("all selected schemas are recursively closed, unique, bounded and provider-explicit", () => {
    const service = new McpService(null!, null!, null!, null!, null!, null!),
      registry = service.tools(),
      before = structuredClone(registry);
    const profile = googleWriteToolProfile(registry);
    expect(profile).toHaveLength(GOOGLE_WRITE_PROFILE_TOOLS.length);
    expect(profile.length).toBeLessThanOrEqual(50);
    expect(new Set(profile.map((t) => t.name)).size).toBe(profile.length);
    for (const tool of profile) {
      closed(tool.inputSchema);
      expect(JSON.stringify(tool.inputSchema)).not.toContain("META_ADS");
      expect(tool.inputSchema).toEqual(
        googleWriteProfileInputSchema(tool.name),
      );
      if (!["commit_preview", "preview_rollback_commit"].includes(tool.name)) {
        expect(tool.inputSchema.required).toContain("provider");
        const props = tool.inputSchema.properties as Record<string, Row>;
        expect(props.provider!.enum).toEqual(["GOOGLE_ADS"]);
        if (props.account_id)
          expect(props.account_id.pattern).toBe("^[0-9]{10}$");
      }
    }
    expect(profile.some((t) => t.name === "confirm_preview")).toBe(false);
    expect(registry).toEqual(before); // default legacy Meta/Public schema source remains untouched
    expect(
      registry.find((t) => t.name === "list_campaigns")!.inputSchema
        .additionalProperties,
    ).toBe(true);
    const api = googleWriteOpenApi(registry, "http://localhost:4402"),
      paths = api.paths as Record<string, Row>;
    expect(Object.keys(paths)).toHaveLength(profile.length);
    for (const t of profile)
      expect(JSON.stringify(paths[`/api/v1/mcp/rest/${t.name}`])).toContain(
        JSON.stringify(t.inputSchema),
      );
  });
  it.each(Object.entries(samples))(
    "%s valid arguments match implemented READ contract",
    (name, args) => {
      expect(() =>
        validateGoogleWriteProfileArguments(name, args),
      ).not.toThrow();
    },
  );
  it.each(Object.entries(samples))(
    "%s rejects missing/wrong provider and unknown keys with HOLYMEDIA field paths",
    (name, args) => {
      const missing = { ...args };
      delete missing.provider;
      expect(error(name, missing).fieldPath).toBe("arguments.provider");
      expect(error(name, { ...args, provider: "META_ADS" }).fieldPath).toBe(
        "arguments.provider",
      );
      expect(
        error(name, { ...args, unexpected: { raw: "provider" } }).fieldPath,
      ).toBe("arguments.unexpected");
      const schema = googleWriteProfileInputSchema(name)!;
      if ((schema.properties as Row).account_id) {
        const noAccount = { ...args };
        delete noAccount.account_id;
        expect(error(name, noAccount).fieldPath).toBe("arguments.account_id");
        expect(
          error(name, { ...args, account_id: "859-014-6099" }).fieldPath,
        ).toBe("arguments.account_id");
      }
    },
  );
  it.each([
    ["list_campaigns", { ...account, limit: 501 }, "arguments.limit"],
    ["list_campaigns", { ...account, limit: 1.1 }, "arguments.limit"],
    ["list_campaigns", { ...account, limit: 0 }, "arguments.limit"],
    [
      "list_campaigns",
      { ...account, cursor: "x".repeat(8193) },
      "arguments.cursor",
    ],
    [
      "list_campaigns",
      { ...account, statuses: ["PAUSED", "PAUSED"] },
      "arguments.statuses",
    ],
    [
      "list_campaigns",
      { ...account, startDate: "2026-10-01", endDate: "2026-10-09" },
      "arguments.startDate",
    ],
    [
      "list_campaigns",
      { ...account, start_date: "2026-10-01" },
      "arguments.end_date",
    ],
    [
      "list_campaigns",
      { ...account, start_date: "2026-02-30", end_date: "2026-10-09" },
      "arguments.start_date",
    ],
    [
      "list_campaigns",
      { ...account, start_date: "2026-10-09", end_date: "2026-10-01" },
      "arguments.end_date",
    ],
    [
      "google_ads_list_keywords",
      {
        ...account,
        since: "2026-10-01",
        until: "2026-10-09",
        date_preset: "last_7d",
      },
      "arguments.date_preset",
    ],
    [
      "google_ads_list_keywords",
      { ...account, campaign_ids: Array(201).fill("1") },
      "arguments.campaign_ids",
    ],
    [
      "google_ads_list_keywords",
      { ...account, min_cost: Infinity },
      "arguments.min_cost",
    ],
    [
      "google_ads_search_terms",
      { ...samples.google_ads_search_terms, format: "csv" },
      "arguments.format",
    ],
    [
      "google_ads_search_terms",
      { ...samples.google_ads_search_terms, contains: "  " },
      "arguments.contains",
    ],
    [
      "get_google_ads_detailed_report",
      { ...account, report_type: "ad_group" },
      "arguments.report_type",
    ],
    [
      "get_account_object",
      { ...account, object_type: "asset" },
      "arguments.object_type",
    ],
    [
      "get_campaign_structure",
      { ...account, include_assets: true },
      "arguments.include_assets",
    ],
    [
      "google_ads_check_negative_conflicts",
      {
        ...samples.google_ads_check_negative_conflicts,
        negatives: [{ text: "test", request: {} }],
      },
      "arguments.negatives[0].request",
    ],
    ["list_change_journal", { ...account, from: "not ISO" }, "arguments.from"],
    [
      "list_change_journal",
      { ...account, from: "2026-02-30T00:00:00Z" },
      "arguments.from",
    ],
    [
      "list_change_journal",
      { ...account, actor_user_id: "not UUID" },
      "arguments.actor_user_id",
    ],
    ["list_change_journal", { ...account, limit: 101 }, "arguments.limit"],
  ] as [string, Row, string][])(
    "%s rejects bounded/unsupported/extra fields at %s",
    (name, args, path) => {
      expect(error(name, args).fieldPath).toBe(path);
    },
  );
  it("commit accepts exact opaque token only; no provider/account/replacement/confirmed override", () => {
    const token = { preview_token: `hmpp_${"x".repeat(43)}` };
    expect(() =>
      validateGoogleWriteProfileArguments("commit_preview", token),
    ).not.toThrow();
    for (const key of [
      "provider",
      "account_id",
      "confirmed",
      "approved",
      "payload",
      "preview_id",
    ])
      expect(
        error("commit_preview", { ...token, [key]: "extra" }).fieldPath,
      ).toBe(`arguments.${key}`);
    expect(
      error("commit_preview", { preview_token: "not-token" }).fieldPath,
    ).toBe("arguments.preview_token");
    expect(error("confirm_preview", token).fieldPath).toBe("arguments.tool");
    expect(googleWriteProfileInputSchema("get_meta_business")).toBeUndefined();
  });
  it("Google branch selection never retains Meta fallback and status resources cannot cross accounts", () => {
    const args = {
      ...account,
      entity_type: "keyword",
      items: [
        {
          campaign_id: "1",
          ad_group_id: "10",
          criterion_id: "101",
          resource_name: "customers/1111111111/adGroupCriteria/10~101",
        },
      ],
    };
    expect(error("pause_entities_preview", args).fieldPath).toBe(
      "arguments.items[0].resource_name",
    );
    args.items[0]!.resource_name =
      "customers/8590146099/adGroupCriteria/10~101";
    expect(() =>
      validateGoogleWriteProfileArguments("pause_entities_preview", args),
    ).not.toThrow();
    for (const name of [
      "create_campaign_from_brief",
      "clone_campaign_preview",
      "preview_change_campaign_budget",
      "preview_update_object",
      "preview_pause_adset_or_group",
    ]) {
      const schema = googleWriteProfileInputSchema(name)!;
      closed(schema);
      expect(JSON.stringify(schema)).not.toContain("META_ADS");
    }
  });
  it("stage unions/conditional requirements are not discarded by closure or validation", () => {
    const bid = {
      ...account,
      items: [
        {
          field: "ad_group_cpc",
          campaign_id: "1",
          ad_group_id: "10",
          change: { mode: "absolute", amount: "0.11", currency: "USD" },
        },
      ],
    };
    expect(() =>
      validateGoogleWriteProfileArguments("google_ads_bid_budget_preview", bid),
    ).not.toThrow();
    expect(
      error("google_ads_bid_budget_preview", {
        ...bid,
        items: [
          {
            ...bid.items[0],
            change: {
              mode: "absolute",
              amount: "0.11",
              currency: "USD",
              percent: "10",
            },
          },
        ],
      }).fieldPath,
    ).toBe("arguments.items[0].change.percent");
    expect(() =>
      validateGoogleWriteProfileArguments("google_ads_negatives_preview", {
        ...account,
        level: "campaign",
        operation: "add",
        items: [{ campaign_id: "1", text: "test", match_type: "EXACT" }],
      }),
    ).not.toThrow();
    expect(
      error("google_ads_negatives_preview", {
        ...account,
        level: "campaign",
        operation: "remove",
        items: [{ campaign_id: "1", criterion_id: "2", text: "unwanted" }],
      }).fieldPath,
    ).toContain("arguments.items[0]");
    expect(() =>
      validateGoogleWriteProfileArguments("google_ads_targeting_preview", {
        ...account,
        items: [
          {
            operation: "language_add",
            level: "CAMPAIGN",
            campaign_id: "1",
            name: "Russian",
          },
        ],
      }),
    ).not.toThrow();
  });
  it("schema is only format validation; actual stock account authorization rejects foreign valid account before mock provider read", async () => {
    const foreign = { ...account, account_id: "1111111111" };
    expect(() =>
      validateGoogleWriteProfileArguments("get_campaign", {
        ...foreign,
        campaign_id: "1",
      }),
    ).not.toThrow();
    const read = vi.fn(),
      db = {
        client: { providerAccount: { findFirst: vi.fn(async () => null) } },
      };
    const service = new McpService(
      db as never,
      { readGoogleCampaign: read } as never,
      null!,
      null!,
      null!,
      null!,
    );
    const principal = {
      kind: "service",
      workspaceId: "workspace",
      accountIds: ["allowed-local-id"],
      scopes: ["adforge:mcp:read"],
    };
    await expect(
      service.callGoogleWriteProfile(principal as never, "get_campaign", {
        ...foreign,
        campaign_id: "1",
      }),
    ).rejects.toThrow("Account is not available");
    expect(read).not.toHaveBeenCalled();
    expect(db.client.providerAccount.findFirst.mock.calls).toHaveLength(1);
  });
  it("malicious caller registry schemas are not authoritative or mutated", () => {
    const input = [
        {
          name: "list_campaigns",
          inputSchema: {
            type: "object",
            additionalProperties: true,
            properties: { request: { type: "object" } },
          },
        },
      ],
      before = structuredClone(input);
    const output = googleWriteToolProfile(input);
    expect(output[0]!.inputSchema.additionalProperties).toBe(false);
    expect(output[0]!.inputSchema.properties).not.toHaveProperty("request");
    expect(input).toEqual(before);
    expect(
      error("list_campaigns", { ...account, query: "SELECT * FROM customer" })
        .fieldPath,
    ).toBe("arguments.query");
    expect(
      error(
        "get_account_status",
        Object.create({
          provider: "GOOGLE_ADS",
          account_id: account.account_id,
        }),
      ).fieldPath,
    ).toBe("arguments");
  });
  it("invalid/oversized unknown key paths do not echo arbitrary user text", () => {
    const result = error("get_account_status", {
      ...account,
      ["untrusted\n" + "x".repeat(300)]: true,
    });
    expect(result.fieldPath).toBe('arguments["<invalid-key>"]');
    expect(result.message).not.toContain("untrusted");
  });
});
