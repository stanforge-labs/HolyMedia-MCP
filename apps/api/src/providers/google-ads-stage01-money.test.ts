import { describe, expect, it, vi } from "vitest";
import { currencyConstantQuery } from "./google-ads-money.js";
import {
  buildStage0Plan,
  rereadStage0Checks,
  type JsonRow,
} from "./google-ads-stage0.js";
import {
  buildStage1Plan,
  canonical,
  currencyMicros,
  keywordCreateFields,
  rereadStage1Checks,
  type Stage1Reader,
} from "./google-ads-stage1.js";

const account = "8590146099",
  prefix = `customers/${account}`;
/** Independent strict mock; does not modify the shared historical acceptance fixture. */
function fixture(currency = "USD", unit = "10000") {
  const state = {
    constant: [
      {
        currencyConstant: {
          resourceName: `currencyConstants/${currency}`,
          code: currency,
          billableUnitMicros: unit,
        },
      },
    ] as JsonRow[],
    bid: "100000",
  };
  const campaign = {
    resourceName: `${prefix}/campaigns/1`,
    id: "1",
    name: "Existing TEST",
    status: "PAUSED",
  };
  const group = {
    resourceName: `${prefix}/adGroups/10`,
    id: "10",
    name: "Existing Group",
    status: "PAUSED",
  };
  const read = vi.fn<Stage1Reader>(async (q) => {
    if (q.includes("FROM currency_constant"))
      return structuredClone(state.constant);
    if (
      q.includes("FROM customer_conversion_goal") ||
      q.includes("FROM conversion_action")
    )
      return [];
    if (q.includes("FROM customer"))
      return [
        {
          customer: {
            resourceName: prefix,
            id: account,
            currencyCode: currency,
            timeZone: "Asia/Almaty",
          },
        },
      ];
    if (q.includes("FROM geo_target_constant"))
      return [
        {
          geoTargetConstant: {
            resourceName: "geoTargetConstants/1009806",
            status: "ENABLED",
          },
        },
      ];
    if (q.includes("FROM language_constant"))
      return [
        {
          languageConstant: {
            resourceName: "languageConstants/1031",
            id: "1031",
            code: "ru",
            name: "Russian",
            targetable: true,
          },
        },
      ];
    if (
      q.includes("FROM campaign_shared_set") ||
      q.includes("FROM campaign_criterion")
    )
      return [];
    if (q.includes("FROM ad_group_criterion")) {
      if (q.includes("negative = TRUE")) return [];
      return [
        {
          campaign,
          adGroup: group,
          adGroupCriterion: {
            resourceName: `${prefix}/adGroupCriteria/10~101`,
            criterionId: "101",
            type: "KEYWORD",
            negative: false,
            status: "ENABLED",
            keyword: { text: "existing keyword", matchType: "EXACT" },
            finalUrls: [],
            cpcBidMicros: state.bid,
          },
        },
      ];
    }
    if (q.includes("FROM ad_group")) return [{ campaign, adGroup: group }];
    if (q.includes("FROM campaign"))
      return q.includes("campaign.name =") ? [] : [{ campaign }];
    throw new Error(`Unexpected mock selector: ${q}`);
  });
  const suggest = vi.fn(async () => [
    {
      geoTargetConstant: {
        id: "1009806",
        resourceName: "geoTargetConstants/1009806",
        name: "Алматы",
        canonicalName: "Алматы,Казахстан",
        countryCode: "KZ",
        status: "ENABLED",
      },
    },
  ]);
  return { state, read, suggest };
}
function brief(currency = "USD", amount = "2", bid = "0.10"): JsonRow {
  return {
    provider: "GOOGLE_ADS",
    account_id: account,
    campaign_name: "TEST authoritative unit",
    daily_budget: { amount, currency },
    locations: [{ name: "Алматы", country_code: "KZ" }],
    languages: ["Russian"],
    ad_groups: [0, 1].map((g) => ({
      name: `Group ${g}`,
      default_bid: { amount: bid, currency },
      keywords: [0, 1, 2, 3, 4].map((k) => ({
        text: `test ${g} ${k}`,
        match_type: "EXACT",
        ...(k === 0 ? { cpc_bid: { amount: bid, currency } } : {}),
      })),
      rsa: [
        {
          final_url: "https://example.test/landing",
          headlines: ["Test one", "Test two", "Test three"].map((text) => ({
            text,
          })),
          descriptions: ["Test description one", "Test description two"].map(
            (text) => ({ text }),
          ),
        },
      ],
    })),
    assets: {
      sitelinks: [0, 1, 2, 3].map((i) => ({
        text: `Test link ${i}`,
        final_url: `https://example.test/${i}`,
      })),
    },
  };
}
const intent = (currency = "USD", amount = "0.105") => ({
  action: "keyword_add",
  items: [
    {
      campaign_id: "1",
      ad_group_id: "10",
      text: "new keyword",
      match_type: "EXACT",
      cpc_bid: { amount, currency },
    },
  ],
});

describe("Stage 0/1 authoritative billable units — standalone mocks, no provider calls", () => {
  it("preserves raw pure-helper defaults; optional proven unit quantizes", () => {
    expect(currencyMicros("0.105", "USD", "USD")).toBe("105000");
    const unit = {
      currency: "USD",
      resource_name: "currencyConstants/USD",
      unit_micros: "10000",
    };
    expect(currencyMicros("0.105", "USD", "USD", unit)).toBe("110000");
    const item = {
      text: "new keyword",
      match_type: "EXACT" as const,
      cpc_bid: { amount: "0.105", currency: "USD" },
    };
    expect(
      keywordCreateFields(
        item,
        { adGroup: `${prefix}/adGroups/10` },
        false,
        "USD",
      ).cpcBidMicros,
    ).toBe("105000");
    expect(
      keywordCreateFields(
        item,
        { adGroup: `${prefix}/adGroups/10` },
        false,
        "USD",
        unit,
      ).cpcBidMicros,
    ).toBe("110000");
    expect(() =>
      currencyMicros("0.1", "USD", "USD", { ...unit, currency: "JPY" }),
    ).toThrow();
  });
  it.each([
    ["USD", "10000", "2", "0.10"],
    ["KZT", "1000000", "1000", "1"],
    ["JPY", "1000000", "1000", "1"],
  ])(
    "Stage0 aligned %s retains exactly 26 atomic operations/all-paused creation",
    async (currency, u, amount, bid) => {
      const f = fixture(currency, u),
        plan = await buildStage0Plan(
          account,
          brief(currency, amount, bid),
          f.read,
          f.suggest,
        );
      expect(plan.operations).toHaveLength(26);
      expect(plan.operations[0]!.fields.amountMicros).toBe(
        currencyMicros(amount, currency, currency),
      );
      expect(
        plan.operations
          .filter((o) => ["campaign", "adGroup", "adGroupAd"].includes(o.kind))
          .every((o) => o.fields.status === "PAUSED"),
      ).toBe(true);
      expect(
        plan.checks.filter((c) => c.query === currencyConstantQuery(currency)),
      ).toHaveLength(1);
      expect(plan.summary.budget).toMatchObject({
        currency,
        billable_unit_micros: u,
        currency_constant: `currencyConstants/${currency}`,
      });
      expect(plan.items[0]!.warnings.join(" ")).toContain(
        `billable_unit_micros=${u}`,
      );
      expect(
        plan.operations.every((o) => !("billableUnitMicros" in o.fields)),
      ).toBe(true);
    },
  );
  it("Stage0 budget/group/explicit keyword CPC quantize once and show each change", async () => {
    const f = fixture(),
      plan = await buildStage0Plan(
        account,
        brief("USD", "2.005", "0.105"),
        f.read,
        f.suggest,
      );
    expect(plan.operations[0]!.fields.amountMicros).toBe("2010000");
    const monetary = plan.operations.filter((o) => o.fields.cpcBidMicros);
    expect(monetary).toHaveLength(4);
    expect(monetary.every((o) => o.fields.cpcBidMicros === "110000")).toBe(
      true,
    );
    for (const op of [plan.operations[0]!, ...monetary])
      expect(plan.items[op.row]!.warnings.join(" ")).toContain("Округление");
    expect(
      f.read.mock.calls.filter(([q]) => q.includes("FROM currency_constant")),
    ).toHaveLength(1);
  });
  it("Stage0 freezes currency constant in canonical stale checks", async () => {
    const f = fixture(),
      plan = await buildStage0Plan(account, brief(), f.read, f.suggest),
      before = canonical(plan.checks);
    expect(canonical(await rereadStage0Checks(plan, f.read))).toBe(before);
    f.state.constant[0] = {
      currencyConstant: {
        resourceName: "currencyConstants/USD",
        code: "USD",
        billableUnitMicros: "100000",
      },
    };
    expect(canonical(await rereadStage0Checks(plan, f.read))).not.toBe(before);
  });
  it("Stage1 positive create quantizes, displays currency and freezes exact unit query", async () => {
    const f = fixture(),
      plan = await buildStage1Plan(account, intent(), f.read);
    expect(plan.operations[0]!.fields.cpcBidMicros).toBe("110000");
    expect(plan.operations[0]!.expected.cpc_bid_micros).toBe("110000");
    expect(plan.items[0]!.after).toMatchObject({
      currency: "USD",
      billable_unit_micros: "10000",
    });
    expect(plan.items[0]!.warnings.join(" ")).toContain("105000 → 110000");
    const unitCheck = plan.checks.find(
      (c) => c.query === currencyConstantQuery("USD"),
    );
    expect(unitCheck!.rows[0]).toMatchObject({
      kind: "currencyConstants",
      resource_name: "currencyConstants/USD",
      currency: "USD",
      billable_unit_micros: "10000",
    });
    expect(canonical(await rereadStage1Checks(plan, f.read))).toBe(
      canonical(plan.checks),
    );
    f.state.constant[0] = {
      currencyConstant: {
        resourceName: "currencyConstants/USD",
        code: "USD",
        billableUnitMicros: "20000",
      },
    };
    expect(canonical(await rereadStage1Checks(plan, f.read))).not.toBe(
      canonical(plan.checks),
    );
  });
  it("Stage1 copied positive CPC on match replacement uses same authoritative unit", async () => {
    const f = fixture();
    f.state.bid = "105000";
    const plan = await buildStage1Plan(
      account,
      {
        action: "keyword_match",
        items: [
          {
            campaign_id: "1",
            ad_group_id: "10",
            criterion_id: "101",
            match_type: "PHRASE",
          },
        ],
      },
      f.read,
    );
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]!.fields.cpcBidMicros).toBe("110000");
    expect(plan.operations[1]!.fields.status).toBe("PAUSED");
    expect(plan.items[0]!.warnings.join(" ")).toContain("105000 → 110000");
    expect(f.state.bid).toBe("105000");
  });
  it.each(["keyword_add", "keyword_match", "keyword_url", "negative_add"])(
    "Stage1 %s without money has no currency-unit dependency",
    async (action) => {
      const f = fixture();
      f.state.bid = "0";
      f.state.constant = [];
      const raw =
        action === "keyword_add"
          ? {
              action,
              items: [
                {
                  campaign_id: "1",
                  ad_group_id: "10",
                  text: "new keyword",
                  match_type: "EXACT",
                },
              ],
            }
          : action === "keyword_match"
            ? {
                action,
                items: [
                  {
                    campaign_id: "1",
                    ad_group_id: "10",
                    criterion_id: "101",
                    match_type: "PHRASE",
                  },
                ],
              }
            : action === "keyword_url"
              ? {
                  action,
                  items: [
                    {
                      campaign_id: "1",
                      ad_group_id: "10",
                      criterion_id: "101",
                      final_url: "https://example.test/new",
                    },
                  ],
                }
              : {
                  action,
                  level: "campaign",
                  items: [
                    {
                      campaign_id: "1",
                      text: "test negative",
                      match_type: "EXACT",
                    },
                  ],
                };
      const plan = await buildStage1Plan(account, raw, f.read);
      expect(plan.operations.length).toBeGreaterThan(0);
      expect(
        f.read.mock.calls.some(([q]) => q.includes("FROM currency_constant")),
      ).toBe(false);
    },
  );
  it("one unit read suffices for a multi-keyword monetary batch", async () => {
    const f = fixture(),
      raw = intent();
    raw.items.push({ ...raw.items[0]!, text: "new second keyword" });
    const plan = await buildStage1Plan(account, raw, f.read);
    expect(plan.operations).toHaveLength(2);
    expect(
      f.read.mock.calls.filter(([q]) => q.includes("FROM currency_constant")),
    ).toHaveLength(1);
  });
  it.each<{ rows: JsonRow[]; code: string }>([
    { rows: [], code: "google_currency_unit_unavailable" },
    {
      rows: [
        {
          currencyConstant: {
            resourceName: "currencyConstants/EUR",
            code: "EUR",
            billableUnitMicros: "10000",
          },
        },
      ],
      code: "google_currency_unit_mismatch",
    },
    {
      rows: [
        {
          currencyConstant: {
            resourceName: "currencyConstants/USD",
            code: "USD",
            billableUnitMicros: "0",
          },
        },
      ],
      code: "google_currency_unit_invalid",
    },
  ])(
    "both builders fail closed for missing/foreign/malformed constants %j",
    async ({ rows, code }) => {
      const f = fixture();
      f.state.constant = rows;
      await expect(
        buildStage0Plan(account, brief(), f.read, f.suggest),
      ).rejects.toMatchObject({ writeCode: code });
      await expect(
        buildStage1Plan(account, intent(), f.read),
      ).rejects.toMatchObject({ writeCode: code });
    },
  );
  it("positive money rounded to zero never becomes a clearing write", async () => {
    const f = fixture();
    await expect(
      buildStage0Plan(account, brief("USD", "0.001"), f.read, f.suggest),
    ).rejects.toMatchObject({ writeCode: "google_money_rounded_zero" });
    await expect(
      buildStage1Plan(account, intent("USD", "0.001"), f.read),
    ).rejects.toMatchObject({ writeCode: "google_money_rounded_zero" });
  });
  it("invalid RSA remains a pre-provider rejection, no unit read or mutation", async () => {
    const f = fixture(),
      b = brief();
    const group = (b.ad_groups as JsonRow[])[0]!;
    ((group.rsa as JsonRow[])[0]!.headlines as JsonRow[])[0]!.text = "x".repeat(
      31,
    );
    await expect(
      buildStage0Plan(account, b, f.read, f.suggest),
    ).rejects.toMatchObject({ writeCode: "google_brief_invalid" });
    expect(f.read).not.toHaveBeenCalled();
  });
});
