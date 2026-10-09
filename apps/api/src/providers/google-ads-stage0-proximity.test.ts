import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeBrief,
  row,
  stage0ProximityFields,
  stage0ProviderOperations,
  stage0Query,
  verifyStage0Mutation,
  buildClonePlan,
  type JsonRow,
  type Stage0Plan,
} from "./google-ads-stage0.js";
import { canonical, type Stage1MutationResult } from "./google-ads-stage1.js";
import {
  campaignBriefSchema,
  validateBriefSchema,
} from "../mcp/mcp-google-stage0-schema.js";
import {
  fixture,
  customer,
  prefix,
  principal,
} from "../mcp/google-write-test.fixture.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function brief(): JsonRow {
  return {
    provider: "GOOGLE_ADS",
    account_id: customer,
    campaign_name: "TEST Stage 0 coordinate radius",
    daily_budget: { amount: "2", currency: "KZT" },
    locations: [{ name: "Алматы", country_code: "KZ" }],
    languages: ["Russian"],
    ad_groups: [0, 1].map((g) => ({
      name: `TEST group ${g}`,
      default_bid: { amount: "1", currency: "KZT" },
      keywords: [0, 1, 2, 3, 4].map((k) => ({
        text: `test ${g} ${k}`,
        match_type: "EXACT",
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
const radius = (extra: JsonRow = {}) => ({
  latitude: 43.238949,
  longitude: 76.889709,
  radius: 10,
  unit: "KILOMETERS",
  ...extra,
});
function created(plan: Stage0Plan) {
  const names = plan.operations.map(
    (o, i) =>
      `${prefix}/${({ campaignBudget: "campaignBudgets", campaign: "campaigns", campaignCriterion: "campaignCriteria", adGroup: "adGroups", adGroupCriterion: "adGroupCriteria", adGroupAd: "adGroupAds", asset: "assets", campaignAsset: "campaignAssets" } as Record<string, string>)[o.kind]}/${1000 + i}`,
  );
  const refs = new Map(
    plan.operations.map((o, i) => [o.resource_name, names[i]!]),
  );
  const resolve = (v: unknown): unknown =>
    typeof v === "string"
      ? (refs.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(resolve)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, resolve(x)]),
            )
          : v;
  const entities: JsonRow[] = plan.operations.map((o, i) => ({
    ...row(resolve(o.expected)),
    resourceName: names[i],
    ...(o.kind === "campaign" ? { biddingStrategyType: "MANUAL_CPC" } : {}),
  }));
  const results: Stage1MutationResult[] = names.map((resource_name) => ({
    success: true,
    resource_name,
    error: null,
  }));
  const read = vi.fn(async (q: string) =>
    plan.operations.flatMap((o, i) =>
      q.includes(
        `FROM ${({ campaignBudget: "campaign_budget", campaign: "campaign", campaignCriterion: "campaign_criterion", adGroup: "ad_group", adGroupCriterion: "ad_group_criterion", adGroupAd: "ad_group_ad", asset: "asset", campaignAsset: "campaign_asset" } as Record<string, string>)[o.kind]} `,
      )
        ? [{ [o.kind]: entities[i] }]
        : [],
    ),
  );
  return { entities, results, read };
}
describe("Stage 0 coordinate-radius profile — mock only, no external calls", () => {
  it("no optional radius preserves original 26 operations and defaults", async () => {
    const f = fixture(true);
    await f.call("create_campaign_from_brief", brief());
    const plan = f.previewsRows[0]!.requestedState as Stage0Plan;
    expect(plan.operations).toHaveLength(26);
    expect(plan.operations.some((o) => o.fields.proximity)).toBe(false);
    expect(plan.summary.proximities).toBeUndefined();
    expect(
      row(plan.operations[1]!.fields.geoTargetTypeSetting)
        .positiveGeoTargetType,
    ).toBe("PRESENCE");
    expect(f.writes()).toBe(0);
  });
  it("adds one exact atomic criterion per optional radius with truthful preview and canonical reread", async () => {
    const f = fixture(true),
      b = {
        ...brief(),
        proximities: [
          radius(),
          radius({
            latitude: -43.238949,
            longitude: -76.889709,
            radius: 3.5,
            unit: "MILES",
          }),
        ],
      };
    const p = await f.call("create_campaign_from_brief", b),
      plan = f.previewsRows[0]!.requestedState as Stage0Plan;
    expect(p.status).toBe("preview");
    expect(plan.operations).toHaveLength(28);
    const ops = plan.operations.filter((o) => o.fields.proximity);
    expect(ops[0]!.fields).toEqual({
      campaign: `${prefix}/campaigns/-2`,
      negative: false,
      proximity: {
        geoPoint: {
          latitudeInMicroDegrees: 43238949,
          longitudeInMicroDegrees: 76889709,
        },
        radius: 10,
        radiusUnits: "KILOMETERS",
      },
    });
    expect(ops[0]!.expected.type).toBe("PROXIMITY");
    expect(ops[1]!.fields.proximity).toMatchObject({
      geoPoint: {
        latitudeInMicroDegrees: -43238949,
        longitudeInMicroDegrees: -76889709,
      },
      radiusUnits: "MILES",
    });
    expect(plan.items[ops[0]!.row]!.keyword).toContain("Radius 10 KILOMETERS");
    expect(plan.summary.proximities).toMatchObject([
      { include: true, presence: "PRESENCE", type: "PROXIMITY" },
      {},
    ]);
    const requests = f.requests.filter((r) =>
      r.url.endsWith("/googleAds:mutate"),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.validateOnly).toBe(true);
    expect(requests[0]!.body.partialFailure).toBe(false);
    expect(f.writes()).toBe(0);
    expect(stage0ProviderOperations(plan)[ops[0]!.row]).toEqual({
      campaignCriterionOperation: { create: ops[0]!.fields },
    });
    const before = canonical(plan),
      mock = created(plan);
    expect(
      (await verifyStage0Mutation(plan, mock.results, mock.read)).status,
    ).toBe("VERIFIED");
    expect(canonical(plan)).toBe(before);
  });
  it("stock mock controlled flow approves one atomic plan and verifies radius, paused children and journal", async () => {
    const f = fixture(true),
      set = f.resources.set.bind(f.resources);
    // The mock Google service derives output-only criterion type from its oneof.
    // Do not send type in the provider create payload or alter production wiring.
    vi.spyOn(f.resources, "set").mockImplementation((name, payload) => {
      const criterion = row(payload.campaignCriterion);
      if (criterion.proximity) criterion.type = "PROXIMITY";
      return set(name, payload);
    });
    const p = await f.call("create_campaign_from_brief", {
        ...brief(),
        proximities: [radius()],
      }),
      plan = f.previewsRows[0]!.requestedState as Stage0Plan;
    const semantic = canonical(plan),
      result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(result.partial_failure).toBe(false);
    expect(f.writes()).toBe(plan.operations.length);
    expect(
      f.requests.filter(
        (r) =>
          r.url.endsWith("/googleAds:mutate") && r.body.validateOnly === false,
      ),
    ).toHaveLength(1);
    expect(canonical(plan)).toBe(semantic);
    const createdCriteria = [...f.resources.values()]
      .map((r) => row(r.campaignCriterion))
      .filter((c) => c.proximity);
    expect(createdCriteria).toHaveLength(1);
    expect(createdCriteria[0]).toMatchObject({
      type: "PROXIMITY",
      negative: false,
      proximity: stage0ProximityFields(radius()),
    });
    for (const key of ["campaign", "adGroup", "adGroupAd"])
      expect(
        [...f.resources.values()]
          .map((r) => row(r[key]))
          .filter((e) => e.resourceName)
          .every((e) => e.status === "PAUSED"),
      ).toBe(true);
    const journal = await f.call("list_change_journal", {});
    expect((journal.items as JsonRow[])[0]!.commit_id).toBe(result.commit_id);
    expect(
      f.events.filter((e) => e.eventType === "mcp_google_stage1_operation"),
    ).toHaveLength(plan.operations.length * 2);
  });
  it.each([
    ["type", "LOCATION"],
    ["campaign", `${prefix}/campaigns/999`],
    ["negative", true],
    [
      "proximity",
      {
        geoPoint: {
          latitudeInMicroDegrees: 1,
          longitudeInMicroDegrees: 76889709,
        },
        radius: 10,
        radiusUnits: "KILOMETERS",
      },
    ],
    [
      "proximity",
      {
        geoPoint: {
          latitudeInMicroDegrees: 43238949,
          longitudeInMicroDegrees: 76889709,
        },
        radius: 11,
        radiusUnits: "KILOMETERS",
      },
    ],
    [
      "proximity",
      {
        geoPoint: {
          latitudeInMicroDegrees: 43238949,
          longitudeInMicroDegrees: 76889709,
        },
        radius: 10,
        radiusUnits: "MILES",
      },
    ],
  ])(
    "verification fails genuine proximity field mismatch %s",
    async (field, value) => {
      const f = fixture(true);
      await f.call("create_campaign_from_brief", {
        ...brief(),
        proximities: [radius()],
      });
      const plan = f.previewsRows[0]!.requestedState as Stage0Plan,
        mock = created(plan),
        index = plan.operations.findIndex((o) => o.fields.proximity);
      mock.entities[index]![String(field)] = value;
      const verification = await verifyStage0Mutation(
        plan,
        mock.results,
        mock.read,
      );
      expect(verification.status).toBe("UNVERIFIED");
      expect(verification.items[index]!.success).toBe(false);
    },
  );
  it("reread query includes type, association and every proximity field", () => {
    const q = stage0Query("campaignCriterion", "campaign.id = 1");
    for (const leaf of [
      "type",
      "campaign",
      "negative",
      "proximity.geo_point.latitude_in_micro_degrees",
      "proximity.geo_point.longitude_in_micro_degrees",
      "proximity.radius",
      "proximity.radius_units",
    ])
      expect(q).toContain(`campaign_criterion.${leaf}`);
  });
  it.each([
    radius({ latitude: NaN }),
    radius({ longitude: Infinity }),
    radius({ latitude: 90.000001 }),
    radius({ longitude: -180.000001 }),
    radius({ latitude: 0.1234567 }),
    radius({ longitude: -0.0000001 }),
    radius({ radius: 0.9 }),
    radius({ radius: 501 }),
    radius({ radius: NaN }),
    radius({ unit: "METERS" }),
    radius({ exclude: true }),
    radius({ negative: false }),
    radius({ address: "fake" }),
    radius({ latitude: "43.238949" }),
    radius({ geoPoint: { latitudeInMicroDegrees: 1 } }),
  ])(
    "invalid radius input rejected before any provider request %#",
    async (p) => {
      const f = fixture(true);
      await expect(
        f.call("create_campaign_from_brief", { ...brief(), proximities: [p] }),
      ).rejects.toBeInstanceOf(Error);
      expect(f.requests).toHaveLength(0);
      expect(f.previewsRows).toHaveLength(0);
      expect(f.writes()).toBe(0);
    },
  );
  it.each([
    [90, 180],
    [-90, -180],
    [0, 0],
    [0.000001, -0.000001],
  ])("exact coordinate boundary %s/%s", (latitude, longitude) => {
    const fields = stage0ProximityFields(radius({ latitude, longitude }));
    expect(row(fields.geoPoint)).toEqual({
      latitudeInMicroDegrees: latitude * 1_000_000,
      longitudeInMicroDegrees: longitude * 1_000_000,
    });
  });
  it("duplicates and >50 radii reject before provider requests", async () => {
    for (const proximities of [
      [radius(), radius()],
      [...Array(51)].map((_, i) => radius({ latitude: i })),
    ]) {
      const f = fixture(true);
      await expect(
        f.call("create_campaign_from_brief", { ...brief(), proximities }),
      ).rejects.toBeInstanceOf(Error);
      expect(f.requests).toHaveLength(0);
    }
  });
  it("all radius mutations count toward the 500 operation limit, never truncate", () => {
    const b = brief(),
      groups = b.ad_groups as JsonRow[];
    groups[0]!.keywords = [...Array(460)].map((_, i) => ({
      text: `test count ${i}`,
      match_type: "EXACT",
    }));
    b.proximities = [...Array(50)].map((_, i) => radius({ latitude: i }));
    expect(() => normalizeBrief(b)).toThrow(/500/);
  });
  it("closed schema exposes only typed human coordinates, units and finite numeric bounds", () => {
    const schema = campaignBriefSchema.properties!.proximities!;
    expect(schema.maxItems).toBe(50);
    expect(schema.items!.additionalProperties).toBe(false);
    expect(schema.items!.required).toEqual([
      "latitude",
      "longitude",
      "radius",
      "unit",
    ]);
    expect(() =>
      validateBriefSchema(NaN, schema.items!.properties!.latitude!),
    ).toThrow();
  });
  it("unconfirmed preview remains blocked before actual mutation", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", {
        ...brief(),
        proximities: [radius()],
      });
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    expect(f.writes()).toBe(0);
  });
  it("radius preview requires write scope and cannot target foreign account", async () => {
    const f = fixture(true),
      b = { ...brief(), proximities: [radius()] };
    await expect(
      f.previews.createGoogleCampaign(
        { ...principal, scopes: ["adforge:mcp:read"] },
        b,
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      f.call("create_campaign_from_brief", { ...b, account_id: "1111111111" }),
    ).rejects.toBeInstanceOf(Error);
    expect(f.requests).toHaveLength(0);
    expect(f.writes()).toBe(0);
  });
  it("expired confirmed radius preview rejects without a mutation", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", {
        ...brief(),
        proximities: [radius()],
      });
    await f.approve(p);
    f.previewsRows[0]!.expiresAt = new Date(0);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_expired" });
    expect(f.writes()).toBe(0);
  });
  it("caller cannot replace approved radius coordinates in immutable commit", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", {
        ...brief(),
        proximities: [radius()],
      });
    await f.approve(p);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
        proximities: [radius({ latitude: 0 })],
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(f.writes()).toBe(0);
  });
  it("clone explicitly rejects negative source radius rather than silently dropping it", async () => {
    const read = vi.fn(async (q: string) =>
      q.includes("FROM campaign_budget")
        ? [
            {
              campaignBudget: {
                resourceName: `${prefix}/campaignBudgets/2`,
                amountMicros: "2000000",
              },
            },
          ]
        : q.includes("FROM customer")
          ? [
              {
                customer: {
                  resourceName: prefix,
                  id: customer,
                  currencyCode: "KZT",
                },
              },
            ]
          : q.includes("FROM campaign_criterion")
            ? [
                {
                  campaignCriterion: {
                    resourceName: `${prefix}/campaignCriteria/1~6`,
                    campaign: `${prefix}/campaigns/1`,
                    type: "PROXIMITY",
                    negative: true,
                    proximity: stage0ProximityFields(radius()),
                  },
                },
              ]
            : q.includes("FROM campaign_shared_set")
              ? []
              : [
                  {
                    campaign: {
                      resourceName: `${prefix}/campaigns/1`,
                      advertisingChannelType: "SEARCH",
                      biddingStrategyType: "MANUAL_CPC",
                      campaignBudget: `${prefix}/campaignBudgets/2`,
                    },
                  },
                ],
    );
    const build = vi.fn();
    await expect(
      buildClonePlan(
        customer,
        {
          provider: "GOOGLE_ADS",
          account_id: customer,
          source_campaign_id: "1",
          new_name: "TEST clone",
        },
        read,
        build,
      ),
    ).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
    expect(build).not.toHaveBeenCalled();
  });
});
