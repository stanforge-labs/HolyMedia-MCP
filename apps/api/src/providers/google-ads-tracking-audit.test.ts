import { describe, expect, it, vi } from "vitest";
import {
  auditGoogleLinksAndUtms,
  getGoogleTrackingSpecs,
  parseTrackingAuditOptions,
} from "./google-ads-tracking-audit.js";
import {
  trackingAuditToolArguments,
  trackingAuditToolSchema,
} from "../mcp/mcp-google-tracking-audit-schema.js";
import { ProviderError } from "./provider.errors.js";
import { ProviderService } from "./provider.service.js";

const account = "8590146099",
  prefix = `customers/${account}`;
function fixture() {
  const customer: Record<string, unknown> = {
    resourceName: prefix,
    id: account,
    trackingUrlTemplate: "https://track.example.com/?destination={lpurl}",
    finalUrlSuffix: "utm_source=google&utm_medium=cpc&utm_campaign=account",
    autoTaggingEnabled: true,
  };
  const campaign: Record<string, unknown> = {
    resourceName: `${prefix}/campaigns/11`,
    id: "11",
    status: "PAUSED",
    trackingUrlTemplate: "",
    finalUrlSuffix: "utm_source=google&utm_medium=cpc&utm_campaign=campaign",
  };
  const adGroup: Record<string, unknown> = {
    resourceName: `${prefix}/adGroups/22`,
    id: "22",
    status: "PAUSED",
    trackingUrlTemplate: "{lpurl}?utm_source=group",
    finalUrlSuffix: "",
  };
  const ad: Record<string, unknown> = {
    resourceName: `${prefix}/ads/33`,
    id: "33",
    trackingUrlTemplate: "",
    finalUrlSuffix: "utm_source=ad&utm_medium=cpc&utm_campaign=ad",
    finalUrls: [
      "https://example.com/?utm_source=ad&utm_medium=cpc&utm_campaign=ad",
    ],
    finalMobileUrls: [],
  };
  const adGroupAd: Record<string, unknown> = {
    resourceName: `${prefix}/adGroupAds/22~33`,
    status: "PAUSED",
    ad,
  };
  const adGroupCriterion: Record<string, unknown> = {
    resourceName: `${prefix}/adGroupCriteria/22~44`,
    criterionId: "44",
    status: "ENABLED",
    negative: false,
    trackingUrlTemplate: "",
    finalUrlSuffix: "",
    finalUrls: [],
    finalMobileUrls: [],
  };
  const read = vi.fn(async (q: string) =>
    q.includes("FROM customer")
      ? [{ customer }]
      : q.includes("FROM campaign")
        ? [{ campaign }]
        : q.includes("FROM ad_group_ad")
          ? [{ campaign, adGroup, adGroupAd }]
          : q.includes("FROM ad_group_criterion")
            ? [{ campaign, adGroup, adGroupCriterion }]
            : [{ campaign, adGroup }],
  );
  return { customer, campaign, adGroup, ad, adGroupAd, adGroupCriterion, read };
}
describe("P244 actual-provider tracking READ and safe syntactic audit, mock only", () => {
  it("uses five fixed account-scoped GAQL reads, explicit fields and independent inheritance", async () => {
    const f = fixture(),
      result = await getGoogleTrackingSpecs(
        account,
        { campaign_ids: ["11"], ad_group_ids: ["22"], ad_id: "33" },
        f.read,
      );
    expect(result.read_call_count).toBe(5);
    expect(result.real_write_call_count).toBe(0);
    expect(result.validate_only_call_count).toBe(0);
    expect(result.rows).toHaveLength(5);
    expect(result.complete).toBe(true);
    const keyword = result.rows.find((r) => r.level === "keyword")!;
    expect(keyword.effective.template).toEqual({
      state: "RESOLVED",
      value: f.adGroup.trackingUrlTemplate,
      source_resource: f.adGroup.resourceName,
    });
    expect(keyword.effective.suffix).toEqual({
      state: "RESOLVED",
      value: f.ad.finalUrlSuffix,
      source_resource: f.ad.resourceName,
    });
    expect(keyword.effective.final_urls.source_resource).toBe(
      f.ad.resourceName,
    );
    for (const [q] of f.read.mock.calls) {
      expect(q).toMatch(/^SELECT /);
      expect(q).toMatch(/ LIMIT /);
      expect(q).not.toMatch(/mutate|metrics|segments\./);
    }
    const query = f.read.mock.calls.find(([q]) =>
      q.includes("FROM ad_group_ad"),
    )![0];
    expect(query).toContain("ad_group_ad.ad.tracking_url_template");
    expect(query).toContain("ad_group_ad.ad.url_custom_parameters");
  });
  it("never guesses served ad even when exactly one ad was returned", async () => {
    const f = fixture(),
      result = await getGoogleTrackingSpecs(account, {}, f.read);
    const keyword = result.rows.find((r) => r.level === "keyword")!;
    expect(keyword.effective.template.state).toBe("UNKNOWN_AD_CONTEXT");
    expect(keyword.effective.suffix.value).toBeNull();
    expect(
      keyword.warnings.some((w) => w.code === "tracking_ad_context_required"),
    ).toBe(true);
    f.adGroupCriterion.finalUrlSuffix = "utm_source=keyword";
    const second = await getGoogleTrackingSpecs(account, {}, f.read);
    expect(
      second.rows.find((r) => r.level === "keyword")!.effective.suffix
        .source_resource,
    ).toBe(f.adGroupCriterion.resourceName);
  });
  it("empty local defaults inherit independently without overwriting provider input", async () => {
    const f = fixture();
    delete f.ad.finalUrlSuffix;
    delete f.adGroupCriterion.finalUrlSuffix;
    const before = JSON.stringify(f.ad),
      result = await getGoogleTrackingSpecs(account, { ad_id: "33" }, f.read);
    expect(
      result.rows.find((r) => r.level === "keyword")!.effective.suffix
        .source_resource,
    ).toBe(f.campaign.resourceName);
    expect(JSON.stringify(f.ad)).toBe(before);
  });
  it("accepts Google lpurl variants and reports syntactic/UTM issues without URL fetch", async () => {
    const f = fixture();
    f.ad.trackingUrlTemplate = "{lpurl+2}?utm_source=google";
    f.ad.finalUrlSuffix = "utm_source=x&utm_source=y&utm_medium=&other=z";
    f.ad.finalUrls = [
      "http://127.0.0.1/private",
      "ftp://example.com/file",
      "https://example.com/?utm_source=x",
    ];
    const result = await auditGoogleLinksAndUtms(
      account,
      { ad_id: "33" },
      f.read,
    );
    const ad = result.rows.find((r) => r.level === "ad")!;
    expect(
      ad.warnings.some(
        (w) =>
          w.field === "tracking_url_template" &&
          ["tracking_url_unsafe", "tracking_url_invalid"].includes(w.code),
      ),
    ).toBe(false);
    expect(ad.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        "tracking_duplicate_utm",
        "tracking_empty_utm",
        "tracking_utm_incomplete",
        "tracking_url_unsafe",
      ]),
    );
    expect(result.landing_reachability).toBe("NOT_CHECKED");
    expect(result.serving_url_expansion).toBe("NOT_EXECUTED");
  });
  it("never returns URL credentials, sensitive query values or custom parameter credentials", async () => {
    const f = fixture();
    f.ad.finalUrls = [
      "https://person:private-value@example.com/path",
      "https://example.com/?access_token=private-value",
      "https://example.com/?state=private-value",
    ];
    f.campaign.trackingUrlTemplate =
      "https://tracker.example.com/?client_secret=private-value&destination={lpurl}";
    f.ad.urlCustomParameters = [
      { key: "session_token", value: "private-value" },
    ];
    const result = await auditGoogleLinksAndUtms(
      account,
      { ad_id: "33" },
      f.read,
    );
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("person:");
    expect(
      result.rows.some((r) =>
        r.warnings.some((w) => w.code === "tracking_credentials_redacted"),
      ),
    ).toBe(true);
  });
  it("validates input before any provider READ, rejects raw GAQL/resources/duplicates/limits", async () => {
    const f = fixture();
    for (const options of [
      { query: "SELECT *" },
      { campaign_ids: [11] },
      { ad_id: 33 },
      { campaign_ids: ["1 OR 1=1"] },
      { campaign_ids: ["11", "11"] },
      { campaign_ids: [] },
      { campaign_ids: Array.from({ length: 21 }, (_, i) => String(i)) },
      { ad_id: `${prefix}/ads/33` },
      { limit: 201 },
      { limit: 1.5 },
      null,
      [],
    ])
      await expect(
        getGoogleTrackingSpecs(account, options, f.read),
      ).rejects.toBeInstanceOf(ProviderError);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("redacts sensitive fragment and nested redirect credentials without requesting either URL", async () => {
    const f = fixture();
    f.ad.finalUrls = [
      "https://example.com/#access_token=private-value",
      "https://example.com/?redirect=https%3A%2F%2Fother.example.com%2F%3Ftoken%3Dprivate-value",
    ];
    const result = await auditGoogleLinksAndUtms(account, {}, f.read);
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(result.rows.find((r) => r.level === "ad")!.local.final_urls).toEqual(
      ["[REDACTED]", "[REDACTED]"],
    );
    expect(f.read).toHaveBeenCalledTimes(5);
  });
  it("unavailable requested IDs and ad context never advertise complete requested audit", async () => {
    const f = fixture();
    const read = async (q: string) =>
      q.includes("FROM ad_group_ad") ? [] : await f.read(q);
    const result = await getGoogleTrackingSpecs(account, { ad_id: "33" }, read);
    expect(result.complete).toBe(false);
    expect(
      result.warnings.some(
        (w) => w.code === "tracking_requested_ad_unavailable",
      ),
    ).toBe(true);
  });
  it("closed schemas and tool parser reject extras/provider mismatch and preserve explicit context", () => {
    expect(trackingAuditToolSchema("unknown")).toBeUndefined();
    expect(
      trackingAuditToolSchema("get_tracking_specs")!.additionalProperties,
    ).toBe(false);
    expect(
      trackingAuditToolArguments("audit_links_and_utms", {
        provider: "GOOGLE_ADS",
        account_id: account,
        ad_id: "33",
        limit: 2,
      }),
    ).toEqual({ action: "audit", options: { ad_id: "33", limit: 2 } });
    for (const args of [
      { provider: "META_ADS", account_id: account },
      { provider: "GOOGLE_ADS", account_id: account, query: "raw" },
      { provider: "GOOGLE_ADS", account_id: account, limit: 2.5 },
      { provider: "GOOGLE_ADS", account_id: account, campaign_ids: ["1", "1"] },
    ])
      expect(() =>
        trackingAuditToolArguments("get_tracking_specs", args),
      ).toThrow();
  });
  it("rejects foreign account, wrong parent, mismatched resource and negative rows", async () => {
    for (const breakRow of [
      (f: ReturnType<typeof fixture>) => {
        f.customer.id = "1234567890";
      },
      (f: ReturnType<typeof fixture>) => {
        f.adGroup.resourceName = "customers/1234567890/adGroups/22";
      },
      (f: ReturnType<typeof fixture>) => {
        f.ad.resourceName = `${prefix}/ads/99`;
      },
      (f: ReturnType<typeof fixture>) => {
        f.adGroupCriterion.negative = true;
      },
      (f: ReturnType<typeof fixture>) => {
        f.adGroupCriterion.resourceName = `${prefix}/adGroupCriteria/99~44`;
      },
    ]) {
      const f = fixture();
      breakRow(f);
      await expect(
        getGoogleTrackingSpecs(account, {}, f.read),
      ).rejects.toBeInstanceOf(ProviderError);
    }
  });
  it("explicit limit+1 truncation cannot advertise full audit or conceal foreign sentinel", async () => {
    const f = fixture(),
      read = vi.fn(async (q: string) =>
        q.includes("FROM campaign")
          ? [
              { campaign: f.campaign },
              {
                campaign: {
                  ...f.campaign,
                  id: "12",
                  resourceName: `${prefix}/campaigns/12`,
                },
              },
            ]
          : await f.read(q),
      );
    const result = await getGoogleTrackingSpecs(account, { limit: 1 }, read);
    expect(result.complete).toBe(false);
    expect(result.truncated_levels).toContain("campaign");
    const bad = vi.fn(async (q: string) =>
      q.includes("FROM campaign")
        ? [
            { campaign: f.campaign },
            {
              campaign: {
                ...f.campaign,
                id: "12",
                resourceName: "customers/1234567890/campaigns/12",
              },
            },
          ]
        : await f.read(q),
    );
    await expect(
      getGoogleTrackingSpecs(account, { limit: 1 }, bad),
    ).rejects.toBeInstanceOf(ProviderError);
  });
  it("preserves structured provider errors; never fabricates healthy/empty audit after failure", async () => {
    const failure = new ProviderError(
      "insufficient_permissions",
      "Google отказал READ.",
      false,
      "403",
      "PERMISSION_DENIED",
    );
    const read = vi.fn(async () => {
      throw failure;
    });
    await expect(getGoogleTrackingSpecs(account, {}, read)).rejects.toBe(
      failure,
    );
    expect(read).toHaveBeenCalledOnce();
  });
  it("supports actual camelCase and equivalent snake_case nested provider fields", async () => {
    const f = fixture(),
      snake = (v: unknown): unknown =>
        Array.isArray(v)
          ? v.map(snake)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, value]) => [
                  k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
                  snake(value),
                ]),
              )
            : v;
    const read = async (q: string) =>
      snake(await f.read(q)) as Record<string, unknown>[];
    expect(
      (await getGoogleTrackingSpecs(account, { ad_id: "33" }, read)).rows.find(
        (r) => r.level === "keyword",
      )!.effective.suffix.value,
    ).toBe(f.ad.finalUrlSuffix);
  });
  it("bounded provider arrays/malformed fields reject instead of dumping unknown payload", async () => {
    const f = fixture();
    f.ad.finalUrls = Array.from({ length: 21 }, () => "https://example.com");
    await expect(
      getGoogleTrackingSpecs(account, {}, f.read),
    ).rejects.toBeInstanceOf(ProviderError);
    f.ad.finalUrls = [];
    f.ad.trackingUrlTemplate = { unexpected: true };
    await expect(
      getGoogleTrackingSpecs(account, {}, f.read),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(parseTrackingAuditOptions({})).toEqual({});
  });
});

describe("ProviderService tracking audit reuses actual read ownership/context", () => {
  function service() {
    const trackingAudit = vi.fn(async () => ({ result: "MOCK_ONLY" })),
      adapter = { getMetrics: vi.fn(), trackingAudit };
    const connection = {
      id: "connection",
      workspaceId: "workspace",
      provider: "GOOGLE_ADS",
      status: "CONNECTED",
      credential: { encryptedPayload: "mock-not-secret", encryptionVersion: 1 },
    };
    const findConnection = vi.fn(
      async ({ where }: { where: { id: string; workspaceId: string } }) =>
        where.workspaceId === "workspace" && where.id === "connection"
          ? connection
          : null,
    );
    const findAccount = vi.fn(
      async ({
        where,
      }: {
        where: {
          id: string;
          connectionId: string;
          workspaceId: string;
          enabled: boolean;
        };
      }) =>
        where.workspaceId === "workspace" &&
        where.connectionId === "connection" &&
        where.id === "account" &&
        where.enabled
          ? {
              id: "account",
              externalAccountId: account,
              provider: "GOOGLE_ADS",
              currency: "USD",
              metadata: { loginCustomerId: "4378327049" },
            }
          : null,
    );
    const instance = new ProviderService(
      {
        client: {
          providerConnection: { findFirst: findConnection },
          providerAccount: { findFirst: findAccount },
        },
      } as never,
      {} as never,
      { adapter: () => adapter } as never,
      {} as never,
      {} as never,
      {
        decrypt: () => ({
          accessToken: "unit-test-sentinel",
          scopes: ["https://www.googleapis.com/auth/adwords"],
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { instance, trackingAudit, findAccount };
  }
  it("reuses DB-owned external account/currency/login context without write gates", async () => {
    const f = service();
    await f.instance.googleTrackingAudit(
      "workspace",
      "connection",
      "account",
      "audit",
      { limit: 10 },
    );
    expect(f.trackingAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: account,
        currency: "USD",
        loginCustomerId: "4378327049",
      }),
      "audit",
      { limit: 10 },
    );
    expect(f.findAccount).toHaveBeenCalledWith({
      where: {
        id: "account",
        workspaceId: "workspace",
        connectionId: "connection",
        enabled: true,
      },
    });
  });
  it("foreign workspace/account rejects before tracking provider requests", async () => {
    const f = service();
    await expect(
      f.instance.googleTrackingAudit(
        "foreign",
        "connection",
        "account",
        "audit",
        {},
      ),
    ).rejects.toThrow();
    await expect(
      f.instance.googleTrackingAudit(
        "workspace",
        "connection",
        "foreign",
        "specs",
        {},
      ),
    ).rejects.toThrow();
    expect(f.trackingAudit).not.toHaveBeenCalled();
  });
});
