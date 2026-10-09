import { describe, expect, it } from "vitest";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { parseStage4Intent } from "../providers/google-ads-stage4.js";
import { stage4ToolSchema } from "./mcp-google-stage4-schema.js";
import {
  customer,
  object,
  prefix,
  principal,
} from "./google-write-test.fixture.js";

const oldSuffix = "utm_source=google&utm_campaign=original";
const oldTemplate = "https://tracker.example.test/?u={lpurl}&v=original";
const newSuffix = "utm_source=google&utm_campaign=changed";
const newTemplate = "https://tracker.example.test/?u={lpurl}&v=changed";
type Level = "account" | "campaign" | "ad_group";
function setup(level: Level = "campaign") {
  const f = extendedFixture();
  // Model canonical CustomerOperation identity, not the legacy mock map alias.
  const account = f.resources.get(`${prefix}/customers/${customer}`)!;
  f.resources.delete(`${prefix}/customers/${customer}`);
  f.resources.set(prefix, account);
  const resource =
    level === "account"
      ? prefix
      : level === "campaign"
        ? `${prefix}/campaigns/1`
        : `${prefix}/adGroups/10`;
  const key =
    level === "account"
      ? "customer"
      : level === "campaign"
        ? "campaign"
        : "adGroup";
  const target = object(f.resources.get(resource)?.[key]);
  Object.assign(target, {
    finalUrlSuffix: oldSuffix,
    trackingUrlTemplate: oldTemplate,
  });
  const identity = {
    level,
    ...(level !== "account" ? { campaign_id: "1" } : {}),
    ...(level === "ad_group" ? { ad_group_id: "10" } : {}),
  };
  const preview = (
    changes: Record<string, unknown> = {
      final_url_suffix: newSuffix,
      tracking_url_template: newTemplate,
    },
  ) =>
    f.call("google_ads_ads_assets_preview", {
      action: "tracking_update",
      items: [{ ...identity, ...changes }],
    });
  return { f, target, preview, resource };
}
const commit = (
  f: ReturnType<typeof extendedFixture>,
  p: Record<string, unknown>,
) =>
  f.mcp.call(principal, "commit_preview", { preview_token: p.preview_token });
const rollback = (f: ReturnType<typeof extendedFixture>, commitId: unknown) =>
  f.mcp
    .call(principal, "preview_rollback_commit", { commit_id: commitId })
    .then(object);

describe("P39 tracking rollback: stock services, mocked HTTP only", () => {
  it.each(["account", "campaign", "ad_group"] as const)(
    "%s restores exact URLs via independent approved inverse and journal",
    async (level) => {
      const { f, target, preview, resource } = setup(level);
      const before = structuredClone(target);
      const p = await preview();
      expect(p.provider_validation).toBe("passed");
      expect(target).toEqual(before);
      await expect(commit(f, p)).rejects.toThrow();
      expect(f.counts().write).toBe(0);
      await f.approve(p);
      const forward = object(await commit(f, p));
      expect(forward.status).toBe("VERIFIED");
      expect(target.finalUrlSuffix).toBe(newSuffix);
      expect(target.trackingUrlTemplate).toBe(newTemplate);
      expect(target.resourceName).toBe(resource);
      const inverse = await rollback(f, forward.commit_id);
      expect(inverse.preview_id).not.toBe(p.preview_id);
      expect(inverse.provider_validation).toBe("passed");
      await expect(commit(f, inverse)).rejects.toThrow();
      expect(f.counts().write).toBe(1);
      await f.approve(inverse);
      const restored = object(await commit(f, inverse));
      expect(restored.status).toBe("VERIFIED");
      expect(target).toEqual(before);
      const journal = JSON.stringify(await f.call("list_change_journal", {}));
      expect(journal).toContain(String(forward.commit_id));
      expect(journal).toContain(String(restored.commit_id));
      expect(f.counts().validate_only).toBe(2);
      expect(f.counts().write).toBe(2);
    },
  );
  it.each(["final_url_suffix", "tracking_url_template"])(
    "inverse only restores changed %s leaf",
    async (field) => {
      const { f, target, preview } = setup();
      const p = await preview({
        [field]: field === "final_url_suffix" ? newSuffix : newTemplate,
      });
      const forwardPlan = object(f.previewsRows[0]!.requestedState);
      const inverseIntent = object(forwardPlan.inverse_intent);
      const inverseRow = object((inverseIntent.items as unknown[])[0]);
      expect(inverseRow[field]).toBe(
        field === "final_url_suffix" ? oldSuffix : oldTemplate,
      );
      expect(
        inverseRow[
          field === "final_url_suffix"
            ? "tracking_url_template"
            : "final_url_suffix"
        ],
      ).toBeUndefined();
      await f.approve(p);
      const r = object(await commit(f, p));
      const inv = await rollback(f, r.commit_id);
      const invPlan = object(f.previewsRows[1]!.requestedState);
      expect(object((invPlan.operations as unknown[])[0]).update_mask).toBe(
        field,
      );
      await f.approve(inv);
      expect(object(await commit(f, inv)).status).toBe("VERIFIED");
      expect(target.finalUrlSuffix).toBe(oldSuffix);
      expect(target.trackingUrlTemplate).toBe(oldTemplate);
    },
  );
  it.each(["account", "campaign", "ad_group"] as const)(
    "%s missing/empty BEFORE restores explicit provider clear with separate approval",
    async (level) => {
      const { f, target, preview } = setup(level);
      delete target.finalUrlSuffix;
      target.trackingUrlTemplate = "";
      const p = await preview();
      const plan = object(f.previewsRows[0]!.requestedState);
      const inverseRow = object(
        (object(plan.inverse_intent).items as unknown[])[0],
      );
      expect(inverseRow.clear_fields).toEqual([
        "final_url_suffix",
        "tracking_url_template",
      ]);
      expect(inverseRow.final_url_suffix).toBeUndefined();
      expect(inverseRow.tracking_url_template).toBeUndefined();
      const immutableNeighbors = {
        name: target.name,
        status: target.status,
        resourceName: target.resourceName,
        campaign: target.campaign,
      };
      await f.approve(p);
      const r = object(await commit(f, p));
      expect(r.status).toBe("VERIFIED");
      const inv = await rollback(f, r.commit_id);
      expect(JSON.stringify(inv)).toContain("CLEAR tracking");
      const op = object(
        (object(f.previewsRows[1]!.requestedState).operations as unknown[])[0],
      );
      expect(op.update_mask).toBe("final_url_suffix,tracking_url_template");
      expect(object(op.fields)).toMatchObject({
        finalUrlSuffix: "",
        trackingUrlTemplate: "",
      });
      await expect(commit(f, inv)).rejects.toThrow();
      expect(f.counts().write).toBe(1);
      await f.approve(inv);
      expect(object(await commit(f, inv)).status).toBe("VERIFIED");
      expect(target.finalUrlSuffix).toBe("");
      expect(target.trackingUrlTemplate).toBe("");
      expect({
        name: target.name,
        status: target.status,
        resourceName: target.resourceName,
        campaign: target.campaign,
      }).toEqual(immutableNeighbors);
      expect(f.counts().write).toBe(2);
    },
  );
  it("invalid captured BEFORE does not promise unusable inverse", async () => {
    const { f, target, preview } = setup();
    target.trackingUrlTemplate = "http://localhost/private/{lpurl}";
    await preview({ tracking_url_template: newTemplate });
    const plan = object(f.previewsRows[0]!.requestedState);
    expect(plan.inverse_intent).toBeUndefined();
    expect(object(object((plan.items as unknown[])[0]).rollback).code).toBe(
      "google_tracking_rollback_previous_invalid",
    );
    expect(f.counts().write).toBe(0);
  });
  it("missing untouched tracking neighbor does not block exact single-leaf inverse", async () => {
    const { f, target, preview } = setup();
    delete target.trackingUrlTemplate;
    const p = await preview({ final_url_suffix: newSuffix });
    await f.approve(p);
    const r = object(await commit(f, p));
    const inv = await rollback(f, r.commit_id);
    await f.approve(inv);
    expect(object(await commit(f, inv)).status).toBe("VERIFIED");
    expect(target.finalUrlSuffix).toBe(oldSuffix);
    expect(target.trackingUrlTemplate).toBeUndefined();
  });
  it("mixed supported/invalid BEFORE batch never advertises unsafe partial inverse", async () => {
    const { f } = setup();
    const group = object(f.resources.get(`${prefix}/adGroups/10`)?.adGroup);
    group.finalUrlSuffix = "not a valid suffix";
    await f.call("google_ads_ads_assets_preview", {
      action: "tracking_update",
      items: [
        { level: "campaign", campaign_id: "1", final_url_suffix: newSuffix },
        {
          level: "ad_group",
          campaign_id: "1",
          ad_group_id: "10",
          final_url_suffix: newSuffix,
        },
      ],
    });
    const plan = object(f.previewsRows[0]!.requestedState);
    expect(plan.inverse_intent).toBeUndefined();
    const items = plan.items as unknown[];
    expect(object(object(items[0]).rollback).supported).toBe(true);
    expect(object(object(items[1]).rollback).code).toBe(
      "google_tracking_rollback_previous_invalid",
    );
    expect(f.counts().write).toBe(0);
  });
  it("sets one tracking neighbor and clears the other with truthful inverse", async () => {
    const { f, target, preview } = setup();
    const p = await preview({
      final_url_suffix: newSuffix,
      clear_fields: ["tracking_url_template"],
    });
    await f.approve(p);
    const r = object(await commit(f, p));
    expect(r.status).toBe("VERIFIED");
    expect(target.finalUrlSuffix).toBe(newSuffix);
    expect(target.trackingUrlTemplate).toBe("");
    const inv = await rollback(f, r.commit_id);
    await f.approve(inv);
    expect(object(await commit(f, inv)).status).toBe("VERIFIED");
    expect(target.finalUrlSuffix).toBe(oldSuffix);
    expect(target.trackingUrlTemplate).toBe(oldTemplate);
  });
  it("clear schema is closed, bounded and unique, runtime rejects set/clear conflicts before reads", async () => {
    const schema = stage4ToolSchema("google_ads_ads_assets_preview")!;
    expect(
      schema.properties!.items!.items!.properties!.clear_fields,
    ).toMatchObject({ minItems: 1, maxItems: 2, uniqueItems: true });
    const { f, preview } = setup();
    for (const changes of [
      { final_url_suffix: newSuffix, clear_fields: ["final_url_suffix"] },
      { clear_fields: ["final_url_suffix", "final_url_suffix"] },
      { clear_fields: [] },
      { clear_fields: ["name"] },
      { final_url_suffix: "" },
    ])
      await expect(preview(changes)).rejects.toThrow();
    expect(f.counts()).toEqual({ read: 0, validate_only: 0, write: 0 });
    expect(() =>
      parseStage4Intent({
        action: "campaign_update",
        items: [{ campaign_id: "1", clear_fields: ["tracking_url_template"] }],
      }),
    ).toThrow();
  });
  it("approved clear preview is stale after a changed provider tracking snapshot", async () => {
    const { f, target, preview } = setup();
    const p = await preview({ clear_fields: ["tracking_url_template"] });
    await f.approve(p);
    target.trackingUrlTemplate = newTemplate;
    await expect(commit(f, p)).rejects.toThrow(/stale/i);
    expect(target.trackingUrlTemplate).toBe(newTemplate);
    expect(f.counts().write).toBe(0);
  });
  it("clear does not bypass foreign account resource proof", async () => {
    const { f, target, preview } = setup();
    target.resourceName = "customers/9999999999/campaigns/1";
    await expect(
      preview({ clear_fields: ["final_url_suffix"] }),
    ).rejects.toThrow();
    expect(f.counts().validate_only).toBe(0);
    expect(f.counts().write).toBe(0);
  });
  it("stale approved forward rejects before mutation and audits", async () => {
    const { f, target, preview } = setup();
    const p = await preview();
    await f.approve(p);
    target.finalUrlSuffix = "external=changed";
    await expect(commit(f, p)).rejects.toThrow(/stale/i);
    expect(f.counts().write).toBe(0);
    expect(f.events.some((e) => object(e.metadata).result === "rejected")).toBe(
      true,
    );
  });
  it("stale approved inverse rejects without restoring over newer provider values", async () => {
    const { f, target, preview } = setup();
    const p = await preview();
    await f.approve(p);
    const r = object(await commit(f, p));
    const inv = await rollback(f, r.commit_id);
    await f.approve(inv);
    target.trackingUrlTemplate =
      "https://tracker.example.test/?u={lpurl}&v=external";
    await expect(commit(f, inv)).rejects.toThrow(/stale/i);
    expect(target.finalUrlSuffix).toBe(newSuffix);
    expect(f.counts().write).toBe(1);
  });
  it("foreign BEFORE identity is fatal before validation/mutation", async () => {
    const { f, target, preview } = setup();
    target.resourceName = "customers/9999999999/campaigns/1";
    await expect(preview()).rejects.toThrow();
    expect(f.counts().validate_only).toBe(0);
    expect(f.counts().write).toBe(0);
  });
  it("immutable inverse cannot accept caller-replaced URL values", async () => {
    const { f, preview } = setup();
    const p = await preview();
    await f.approve(p);
    const r = object(await commit(f, p));
    const inv = await rollback(f, r.commit_id);
    await f.approve(inv);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: inv.preview_token,
        final_url_suffix: "injected=1",
      }),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });
});
