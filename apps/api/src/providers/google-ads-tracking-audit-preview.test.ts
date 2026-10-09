import { describe, expect, it, vi } from "vitest";
import { buildStage4Plan } from "./google-ads-stage4.js";
import {
  auditGoogleTrackingContext,
  safeGoogleTrackingSummary,
} from "./google-ads-tracking-audit.js";
import { canonical } from "./google-ads-stage1.js";
import { rereadExtendedChecks } from "./google-ads-extended-plan.js";

const account = "8590146099",
  prefix = `customers/${account}`;
function fixture() {
  const customer: Record<string, unknown> = {
    id: account,
    resourceName: prefix,
    currencyCode: "USD",
    timeZone: "Asia/Almaty",
    trackingUrlTemplate: "https://root.example.com/?u={lpurl}",
    finalUrlSuffix: "utm_source=root&utm_medium=cpc&utm_campaign=root",
  };
  const campaign: Record<string, unknown> = {
    id: "1",
    resourceName: `${prefix}/campaigns/1`,
    name: "Paused TEST",
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    trackingUrlTemplate: "",
    finalUrlSuffix: "utm_source=campaign&utm_medium=cpc&utm_campaign=campaign",
  };
  const group: Record<string, unknown> = {
    id: "2",
    resourceName: `${prefix}/adGroups/2`,
    campaign: campaign.resourceName,
    name: "Group",
    status: "PAUSED",
    type: "SEARCH_STANDARD",
    trackingUrlTemplate: "",
    finalUrlSuffix: "local=1",
  };
  const read = vi.fn(async (q: string) =>
    structuredClone(
      q.includes("FROM customer")
        ? [{ customer }]
        : q.includes("FROM campaign")
          ? [{ campaign }]
          : q.includes("FROM ad_group ")
            ? [{ adGroup: group }]
            : [],
    ),
  );
  return { customer, campaign, group, read };
}
const intent = (items: Record<string, unknown>[]) => ({
  provider: "GOOGLE_ADS",
  account_id: account,
  action: "tracking_update",
  items,
});
const object = (v: unknown) => v as Record<string, unknown>;
describe("P244 Stage4 preview consumes the shared actual READ audit (mock only)", () => {
  it.each(["account", "campaign", "ad_group"] as const)(
    "%s exact BEFORE/proposed AFTER without full inventory/landing calls",
    async (level) => {
      const f = fixture(),
        identity = {
          level,
          ...(level !== "account" ? { campaign_id: "1" } : {}),
          ...(level === "ad_group" ? { ad_group_id: "2" } : {}),
        };
      const inputBefore = structuredClone({
        customer: f.customer,
        campaign: f.campaign,
        group: f.group,
      });
      const plan = await buildStage4Plan(
        account,
        intent([
          {
            ...identity,
            final_url_suffix: "utm_source=new&utm_medium=cpc&utm_campaign=new",
          },
        ]),
        f.read,
      );
      const audit = object(object(plan.items[0]).tracking_audit),
        before = object(audit.before),
        after = object(audit.after);
      expect(audit.source).toBe("GOOGLE_ADS_READ");
      expect(before.scope).toBe("EXACT_LOCAL_AND_PARENT_FIELDS");
      expect(before.downstream_urls).toBe("NOT_READ");
      expect(after.landing_reachability).toBe("NOT_CHECKED");
      expect(object(object(after.effective).suffix).value).toBe(
        "utm_source=new&utm_medium=cpc&utm_campaign=new",
      );
      expect(plan.operations[0]!.update_mask).toBe("final_url_suffix");
      expect(plan.operations[0]!.fields).not.toHaveProperty(
        "trackingUrlTemplate",
      );
      expect(plan.operations[0]!.expected.trackingUrlTemplate).toEqual(
        plan.operations[0]!.before!.trackingUrlTemplate,
      );
      expect(plan.inverse_intent).toBeDefined();
      expect({
        customer: f.customer,
        campaign: f.campaign,
        group: f.group,
      }).toEqual(inputBefore);
      for (const [q] of f.read.mock.calls)
        expect(q).not.toMatch(
          /FROM ad_group_ad|FROM ad_group_criterion|LIMIT|mutate/,
        );
      expect(
        plan.checks.some((c) =>
          c.query.includes(
            "customer.final_url_suffix, customer.tracking_url_template",
          ),
        ),
      ).toBe(true);
    },
  );
  it("typed CLEAR reveals exact independent parent inheritance, not invented defaults", async () => {
    const f = fixture();
    f.group.trackingUrlTemplate = "https://group.example.com/?u={lpurl}";
    const plan = await buildStage4Plan(
      account,
      intent([
        {
          level: "ad_group",
          campaign_id: "1",
          ad_group_id: "2",
          clear_fields: ["final_url_suffix"],
        },
      ]),
      f.read,
    );
    const audit = object(object(plan.items[0]).tracking_audit),
      before = object(audit.before),
      after = object(audit.after);
    expect(object(object(before.effective).suffix).source_resource).toBe(
      f.group.resourceName,
    );
    expect(object(object(after.effective).suffix)).toEqual({
      value: f.campaign.finalUrlSuffix,
      source_resource: f.campaign.resourceName,
    });
    expect(object(object(after.effective).template).source_resource).toBe(
      f.group.resourceName,
    );
    expect(plan.operations[0]!.fields.finalUrlSuffix).toBe("");
    expect(plan.operations[0]!.fields).not.toHaveProperty(
      "trackingUrlTemplate",
    );
  });
  it("batch AFTER includes exact proposed ancestor overrides with explicit partial-result assumption", async () => {
    const f = fixture();
    f.group.finalUrlSuffix = "local=1";
    const plan = await buildStage4Plan(
      account,
      intent([
        {
          level: "ad_group",
          campaign_id: "1",
          ad_group_id: "2",
          clear_fields: ["final_url_suffix"],
        },
        {
          level: "campaign",
          campaign_id: "1",
          final_url_suffix: "utm_source=parent&utm_medium=cpc&utm_campaign=new",
        },
      ]),
      f.read,
    );
    const audit = object(object(plan.items[0]).tracking_audit);
    expect(audit.after_assumption).toBe(
      "ALL_REQUESTED_ANCESTOR_WRITES_SUCCEED",
    );
    expect(object(object(object(audit.after).effective).suffix).value).toBe(
      "utm_source=parent&utm_medium=cpc&utm_campaign=new",
    );
    expect(plan.atomic).toBe(false);
    expect(
      plan.items[0]!.warnings.some((w) => w.includes("partial_failure")),
    ).toBe(true);
  });
  it("READ parent tracking state is frozen in stale checks and changed inheritance is observable", async () => {
    const f = fixture();
    const plan = await buildStage4Plan(
      account,
      intent([
        {
          level: "campaign",
          campaign_id: "1",
          clear_fields: ["final_url_suffix"],
        },
      ]),
      f.read,
    );
    const frozen = canonical(plan.checks);
    f.customer.finalUrlSuffix =
      "utm_source=external&utm_medium=cpc&utm_campaign=external";
    const fresh = await rereadExtendedChecks(plan, f.read);
    expect(canonical(fresh)).not.toBe(frozen);
    expect(canonical(plan.checks)).toBe(frozen);
    const queryCounts = f.read.mock.calls.map(([q]) => q);
    expect(new Set(plan.checks.map((c) => c.query)).size).toBe(
      plan.checks.length,
    );
    expect(
      queryCounts.filter((q) => q.includes("customer.final_url_suffix")).length,
    ).toBe(2);
  });
  it("safe BEFORE syntax warnings/redaction do not mutate raw snapshots or invent rollback", async () => {
    const f = fixture();
    f.campaign.trackingUrlTemplate =
      "https://person:private-value@legacy.example.com/?u={lpurl}";
    const plan = await buildStage4Plan(
      account,
      intent([
        {
          level: "campaign",
          campaign_id: "1",
          tracking_url_template: "https://safe.example.com/?u={lpurl}",
        },
      ]),
      f.read,
    );
    const audit = object(object(plan.items[0]).tracking_audit);
    expect(JSON.stringify(audit)).not.toContain("private-value");
    expect(JSON.stringify(audit)).toContain("tracking_credentials_redacted");
    expect(plan.operations[0]!.before!.trackingUrlTemplate).toContain(
      "private-value",
    );
    expect(JSON.stringify(safeGoogleTrackingSummary(plan.items))).not.toContain(
      "private-value",
    );
    expect(plan.inverse_intent).toBeUndefined();
    expect(
      plan.items[0]!.warnings.some((w) =>
        w.includes("google_tracking_rollback_previous_invalid"),
      ),
    ).toBe(true);
  });
  it("shares READ audit UTM warnings while preserving valid proposed field and neighbor", async () => {
    const f = fixture();
    f.campaign.finalUrlSuffix = "utm_source=old&utm_source=duplicate";
    const plan = await buildStage4Plan(
      account,
      intent([
        {
          level: "campaign",
          campaign_id: "1",
          final_url_suffix: "utm_source=new",
        },
      ]),
      f.read,
    );
    expect(
      plan.items[0]!.warnings.some((w) =>
        w.includes("BEFORE: tracking_duplicate_utm"),
      ),
    ).toBe(true);
    expect(
      plan.items[0]!.warnings.some((w) =>
        w.includes("AFTER: tracking_utm_incomplete"),
      ),
    ).toBe(true);
    expect(plan.operations[0]!.fields.finalUrlSuffix).toBe("utm_source=new");
    expect(plan.operations[0]!.fields).not.toHaveProperty(
      "trackingUrlTemplate",
    );
  });
  it("foreign/partial parent context rejects before operations, no weakening existing typed validation", async () => {
    const f = fixture();
    f.customer.resourceName = "customers/1234567890";
    await expect(
      buildStage4Plan(
        account,
        intent([
          { level: "campaign", campaign_id: "1", final_url_suffix: "x=1" },
        ]),
        f.read,
      ),
    ).rejects.toThrow();
    expect(() =>
      auditGoogleTrackingContext(account, [
        { level: "ad_group", fields: f.group },
      ]),
    ).toThrow();
    expect(() =>
      auditGoogleTrackingContext(account, [
        { level: "account", fields: { ...f.customer, resourceName: prefix } },
        { level: "campaign", fields: f.campaign },
        {
          level: "ad_group",
          fields: { ...f.group, campaign: `${prefix}/campaigns/99` },
        },
      ]),
    ).toThrow();
    await expect(
      buildStage4Plan(
        account,
        intent([
          {
            level: "campaign",
            campaign_id: "1",
            tracking_url_template: "http://127.0.0.1/?u={lpurl}",
          },
        ]),
        fixture().read,
      ),
    ).rejects.toThrow();
  });
});
