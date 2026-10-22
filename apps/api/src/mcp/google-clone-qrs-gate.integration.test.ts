import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import type { AppConfig } from "@holymedia/config";
import { fixture, principal, object } from "./google-write-test.fixture.js";
import { qrsCloneWriteAllowed } from "../providers/google-ads-write.js";
import type { Stage0Plan } from "../providers/google-ads-stage0.js";

vi.mock("@holymedia/site-audit", () => ({
  safeGet: vi.fn(async (url: string) => ({
    statusCode: 200,
    url,
    body: Buffer.from("ok"),
    headers: {},
  })),
}));

const account = "8590146099";
const sourceId = "24341802696";
const sourceBrief = {
  provider: "GOOGLE_ADS",
  account_id: account,
  campaign_name: "Source fixture",
  daily_budget: { amount: "2", currency: "KZT" },
  locations: [{ name: "Алматы", country_code: "KZ" }],
  languages: ["русский"],
  ad_groups: [
    {
      name: "Source group",
      default_bid: { amount: "0.1", currency: "KZT" },
      keywords: [{ text: "fixture query", match_type: "EXACT" }],
      rsa: [
        {
          final_url: "https://example.test/landing",
          headlines: [
            "First headline",
            "Second headline",
            "Third headline",
          ].map((text) => ({ text })),
          descriptions: ["First description", "Second description"].map(
            (text) => ({ text }),
          ),
        },
      ],
    },
  ],
};

async function setup() {
  const f = fixture(true, {
    customerId: account,
    initialSequence: 24341802694,
  });
  await f.commit(await f.call("create_campaign_from_brief", sourceBrief));
  const source = [...f.resources.values()]
    .map((entry) => object(entry.campaign))
    .find((campaign) => campaign.name === "Source fixture");
  expect(source?.id).toBe(sourceId);
  const isolated = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
    QRS_TEST_RESTRICTED_AUTH: "true",
    QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED: "true",
    QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID: sourceId,
    QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: account,
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  });
  Object.assign(f.adapter, { config: isolated });
  Object.assign(f.previews, { config: isolated });
  return { f, isolated, source };
}

const clone = (f: Awaited<ReturnType<typeof setup>>["f"]) =>
  f.call("clone_campaign_preview", {
    source_campaign_id: sourceId,
    new_name: "TEST clone gate",
    new_budget: { amount: "3", currency: "KZT" },
    new_dates: {},
  });
const plan = (f: Awaited<ReturnType<typeof setup>>["f"]) =>
  f.previewsRows.at(-1)!.requestedState as Stage0Plan;
const confirmedMutates = (f: Awaited<ReturnType<typeof setup>>["f"]) =>
  f.requests.filter(
    (request) =>
      request.url.endsWith("/googleAds:mutate") &&
      request.body.validateOnly === false,
  );

describe("isolated TEST Search Clone commit gate", () => {
  it("allows only the approved frozen PAUSED Search/RSA clone and never mutates source", async () => {
    const { f, isolated, source } = await setup();
    const preview = await clone(f);
    expect(qrsCloneWriteAllowed(isolated, plan(f))).toBe(true);
    const sourceBefore = structuredClone(source);
    const writesBefore = f.writes();
    await expect(
      f.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    expect(f.writes()).toBe(writesBefore);
    await f.approve(preview);
    const result = await f.previews.commit(
      principal,
      String(preview.preview_token),
    );
    expect(result).toMatchObject({
      status: "VERIFIED",
      provider_mutation_attempted: true,
    });
    expect(f.writes()).toBe(writesBefore + plan(f).operations.length);
    expect(confirmedMutates(f)).toHaveLength(2); // source fixture + approved clone
    expect(source).toEqual(sourceBefore);
    expect(
      [...f.resources.values()]
        .map((entry) => object(entry.campaign))
        .find((campaign) => campaign.name === "TEST clone gate")?.status,
    ).toBe("PAUSED");
    await expect(
      f.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toThrow();
    expect(confirmedMutates(f)).toHaveLength(2);
  });

  it("rejects stale source before provider mutation", async () => {
    const { f, source } = await setup();
    const preview = await clone(f);
    await f.approve(preview);
    const writesBefore = f.writes();
    source!.name = "Externally changed";
    await expect(
      f.adapter.stage0(f.context, "commit", plan(f)),
    ).rejects.toMatchObject({ writeCode: "google_preview_stale" });
    await expect(
      f.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
    expect(f.writes()).toBe(writesBefore);
  });

  it("rejects an expired approval and never sends a confirmed provider request", async () => {
    const { f } = await setup();
    const preview = await clone(f);
    await f.approve(preview);
    const writesBefore = f.writes();
    f.previewsRows.at(-1)!.expiresAt = new Date(0);
    await expect(
      f.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toMatchObject({ code: "preview_expired" });
    expect(f.writes()).toBe(writesBefore);
    expect(confirmedMutates(f)).toHaveLength(1);
  });

  it("rejects a different tenant principal before the one-time claim", async () => {
    const { f } = await setup();
    const preview = await clone(f);
    await f.approve(preview);
    const writesBefore = f.writes();
    await expect(
      f.previews.commit(
        { ...principal, workspaceId: "other-workspace" },
        String(preview.preview_token),
      ),
    ).rejects.toBeDefined();
    expect(f.writes()).toBe(writesBefore);
    expect(confirmedMutates(f)).toHaveLength(1);
  });

  it("blocks non-clone Stage 0 and direct adapter mutations with generic V2 OFF", async () => {
    const { f } = await setup();
    const preview = await f.call("create_campaign_from_brief", {
      ...sourceBrief,
      campaign_name: "Unrelated create",
    });
    await f.approve(preview);
    const writesBefore = f.writes();
    await expect(
      f.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toMatchObject({ writeCode: "confirmed_write_disabled" });
    const unrelated = f.previewsRows.at(-1)!.requestedState as Stage0Plan;
    await expect(
      f.adapter.stage0(f.context, "commit", unrelated),
    ).rejects.toMatchObject({ writeCode: "confirmed_write_disabled" });
    expect(f.writes()).toBe(writesBefore);
    expect(confirmedMutates(f)).toHaveLength(1);
  });

  it("leaves an ambiguous Google response unverified and never automatically retries", async () => {
    const { f } = await setup();
    const preview = await clone(f);
    await f.approve(preview);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = await originalFetch(url, init);
        if (
          url.endsWith("/googleAds:mutate") &&
          JSON.parse(String(init?.body)).validateOnly === false
        )
          throw new Error("lost response after provider mutation");
        return response;
      }),
    );
    const result = await f.previews.commit(
      principal,
      String(preview.preview_token),
    );
    expect(result.status).not.toBe("VERIFIED");
    expect(confirmedMutates(f)).toHaveLength(2); // source fixture plus one exact clone attempt
    await expect(
      f.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toThrow();
    expect(confirmedMutates(f)).toHaveLength(2);
  });

  it("fails closed for ENABLED targets, another source/account/origin, and every broader gate", async () => {
    const { f, isolated } = await setup();
    await clone(f);
    const frozen = plan(f);
    expect(qrsCloneWriteAllowed(isolated, frozen)).toBe(true);
    const campaign = frozen.operations.find((o) => o.kind === "campaign")!;
    const enabled = structuredClone(frozen);
    enabled.operations.find((o) => o.kind === "campaign")!.fields.status =
      "ENABLED";
    expect(qrsCloneWriteAllowed(isolated, enabled)).toBe(false);
    await expect(
      f.adapter.stage0(f.context, "commit", enabled),
    ).rejects.toMatchObject({ writeCode: "confirmed_write_disabled" });
    expect(
      qrsCloneWriteAllowed(isolated, { ...frozen, account_id: "4378327049" }),
    ).toBe(false);
    expect(() =>
      f.adapter.stage0(
        { ...f.context, accountId: "4378327049" },
        "commit",
        frozen,
      ),
    ).toThrow();
    for (const drift of [
      { qrsTestCloneSourceCampaignId: "24341802695" },
      { publicBaseUrl: "https://mcp.holymedia.kz" },
      { qrsTestRestrictedAuth: false },
      { googleAdsWriteAccountAllowlist: ["4378327049"] },
      { confirmedWriteEnabled: true },
      { qrsTestGoogleConfirmedWriteEnabled: true },
      { providerGoogleAdsStage2WriteEnabled: true },
      { providerGoogleAdsStage3WriteEnabled: true },
      { providerGoogleAdsStage4WriteEnabled: true },
      { publicMcpControlledWriteEnabled: true },
    ] satisfies Partial<AppConfig>[])
      expect(qrsCloneWriteAllowed({ ...isolated, ...drift }, frozen)).toBe(
        false,
      );
    expect(campaign.fields.status).toBe("PAUSED");
  });
});
