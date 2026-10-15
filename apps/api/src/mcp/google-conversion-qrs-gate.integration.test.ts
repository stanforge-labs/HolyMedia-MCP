import { describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { object, principal } from "./google-write-test.fixture.js";
import {
  qrsConversionActionIntentAllowed,
  qrsConversionActionWriteAllowed,
} from "../providers/google-ads-conversion-test-gate.js";
import type { ExtendedPlan } from "../providers/google-ads-extended-plan.js";

const account = "8590146099";
const prefix = `customers/${account}`;
const name = "HM_MCP_TEST_SIGNUP_20261015_ACCEPTANCE";

function prepared() {
  const f = extendedFixture({ customerId: account });
  Object.assign(
    object(f.resources.get(`${prefix}/customers/${account}`)?.customer),
    {
      testAccount: true,
      conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
    },
  );
  const isolated = loadConfig({
    NODE_ENV: "test",
    HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
    QRS_TEST_RESTRICTED_AUTH: "true",
    QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED: "true",
    QRS_TEST_CONVERSION_ACTION_NAME: name,
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: account,
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_API_VERSION: "v24",
  });
  Object.assign(f.adapter, { config: isolated });
  Object.assign(f.previews, { config: isolated });
  const raw = { action: "conversion_action_create", items: [{ name }] };
  const preview = () => f.call("google_ads_conversion_action_preview", raw);
  const plan = () => f.previewsRows.at(-1)!.requestedState as ExtendedPlan;
  const commit = (p: Record<string, unknown>) =>
    f.previews.commit(principal, String(p.preview_token));
  return { ...f, isolated, raw, preview, plan, commit };
}

describe("isolated TEST ConversionAction gate", () => {
  it("remains OFF by default and rejects unrelated Stage 4 operations", async () => {
    const f = prepared();
    expect(
      loadConfig({ NODE_ENV: "test" })
        .qrsTestConversionActionConfirmedWriteEnabled,
    ).toBe(false);
    expect(qrsConversionActionIntentAllowed(f.isolated, account, f.raw)).toBe(
      true,
    );
    expect(
      qrsConversionActionIntentAllowed(f.isolated, account, {
        ...f.raw,
        action: "pmax_create",
      }),
    ).toBe(false);
    await expect(
      f.call("google_ads_pmax_preview", { action: "pmax_create", items: [{}] }),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });

  it("requires provider validation and separate approval, then allows one immutable commit", async () => {
    const f = prepared();
    const p = await f.preview();
    expect(p.provider_validation).toBe("passed");
    expect(f.counts()).toMatchObject({ validate_only: 1, write: 0 });
    expect(qrsConversionActionWriteAllowed(f.isolated, f.plan())).toBe(true);
    await expect(f.commit(p)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const result = await f.commit(p);
    expect(result).toMatchObject({ status: "VERIFIED", atomic: true });
    expect(f.counts().write).toBe(1);
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });

  it("rejects foreign, wrong conversion customer, stale, expired and unapproved intents", async () => {
    const f = prepared();
    const p = await f.preview();
    const plan = f.plan();
    for (const mutation of [
      { ...plan, account_id: "4378327049" },
      { ...plan, operations: [{ ...plan.operations[0]!, kind: "campaigns" }] },
      {
        ...plan,
        operations: [
          {
            ...plan.operations[0]!,
            fields: { ...plan.operations[0]!.fields, status: "PAUSED" },
          },
        ],
      },
      { ...plan, intent: { ...plan.intent, action: "pmax_create" } },
    ]) {
      expect(qrsConversionActionWriteAllowed(f.isolated, mutation)).toBe(false);
      await expect(
        f.adapter.extended(f.context, 4, "commit", mutation),
      ).rejects.toThrow();
    }
    for (const drift of [
      { publicBaseUrl: "https://mcp.holymedia.kz" },
      { googleAdsWriteAccountAllowlist: ["4378327049"] },
      { confirmedWriteEnabled: true },
      { qrsTestConversionActionConfirmedWriteEnabled: false },
      { providerGoogleAdsStage4WriteEnabled: true },
    ] satisfies Partial<AppConfig>[])
      expect(
        qrsConversionActionWriteAllowed({ ...f.isolated, ...drift }, plan),
      ).toBe(false);
    await expect(
      f.previews.commit(
        { ...principal, workspaceId: "foreign" },
        String(p.preview_token),
      ),
    ).rejects.toThrow();
    f.previewsRows.at(-1)!.expiresAt = new Date(0);
    await expect(f.commit(p)).rejects.toMatchObject({
      code: "preview_expired",
    });
    expect(f.counts().write).toBe(0);
  });

  it("rejects a provider-side stale name without issuing a create mutation", async () => {
    const f = prepared();
    const p = await f.preview();
    await f.approve(p);
    f.resources.set(`${prefix}/conversionActions/777`, {
      conversionAction: {
        resourceName: `${prefix}/conversionActions/777`,
        name,
      },
    });
    await expect(
      f.adapter.extended(f.context, 4, "commit", f.plan()),
    ).rejects.toMatchObject({ writeCode: "google_preview_stale" });
    await expect(f.commit(p)).rejects.toMatchObject({
      code: "google_preview_stale",
    });
    expect(f.counts().write).toBe(0);
  });
});
