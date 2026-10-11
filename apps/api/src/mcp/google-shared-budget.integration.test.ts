import { describe, expect, it } from "vitest";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { object, prefix, principal } from "./google-write-test.fixture.js";
import { publicTools } from "./mcp-public-tools.js";
const tool = "google_ads_shared_budget_setup_preview";
function fixture() {
  const f = extendedFixture(),
    c = object(f.resources.get(`${prefix}/campaigns/1`)?.campaign);
  object(
    f.resources.get(`${prefix}/customers/${prefix.split("/")[1]}`)?.customer,
  ).testAccount = true;
  c.experimentType = "BASE";
  const b = object(
    f.resources.get(`${prefix}/campaignBudgets/20`)?.campaignBudget,
  );
  Object.assign(b, { id: "20", status: "ENABLED", type: "STANDARD" });
  f.resources.set(`${prefix}/campaigns/2`, {
    campaign: {
      ...structuredClone(c),
      id: "2",
      resourceName: `${prefix}/campaigns/2`,
      name: "second TEST",
      campaignBudget: `${prefix}/campaignBudgets/21`,
    },
  });
  f.resources.set(`${prefix}/campaignBudgets/21`, {
    campaignBudget: {
      ...structuredClone(b),
      id: "21",
      resourceName: `${prefix}/campaignBudgets/21`,
      name: "second TEST",
    },
  });
  return f;
}
const preview = (f: ReturnType<typeof fixture>) =>
  f.call(tool, {
    operation: "create_and_attach",
    name: "HM_MCP_ACCEPTANCE_SHARED_integration",
    daily_budget: { amount: "2.00", currency: "KZT" },
    campaign_ids: ["1", "2"],
  });
const commit = (f: ReturnType<typeof fixture>, p: Record<string, unknown>) =>
  f.mcp.call(principal, "commit_preview", { preview_token: p.preview_token });
const campaign = (f: ReturnType<typeof fixture>, id = "1") =>
  object(f.resources.get(`${prefix}/campaigns/${id}`)?.campaign);
describe("TEST shared-budget stock MCP human lifecycle: mocked provider only", () => {
  it("creates atomically only after manual approval, rereads/audits and explicit fresh restore leaves safe residual", async () => {
    const f = fixture(),
      original = structuredClone([campaign(f), campaign(f, "2")]),
      p = await preview(f);
    expect(p.atomic).toBe(true);
    expect(p.partial_failure).toBe(false);
    expect(p.operation_count).toBe(3);
    expect(f.counts().write).toBe(0);
    expect(JSON.stringify(p.items)).toContain("affected_campaigns");
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const result = object(await commit(f, p));
    expect(result.status).toBe("VERIFIED");
    expect(campaign(f).campaignBudget).toBe(campaign(f, "2").campaignBudget);
    const created = object(
      f.resources.get(String(campaign(f).campaignBudget))?.campaignBudget,
    );
    expect(created).toMatchObject({
      explicitlyShared: true,
      amountMicros: "2000000",
      period: "DAILY",
      status: "ENABLED",
    });
    await expect(
      f.mcp.call(principal, "preview_rollback_commit", {
        commit_id: result.commit_id,
      }),
    ).rejects.toThrow(/inverse|rollback/i);
    const restore = await f.call(tool, {
      operation: "assign",
      assignments: [
        { campaign_id: "1", budget_id: "20" },
        { campaign_id: "2", budget_id: "21" },
      ],
    });
    expect(restore.preview_id).not.toBe(p.preview_id);
    await expect(commit(f, restore)).rejects.toThrow();
    await f.approve(restore);
    const restored = object(await commit(f, restore));
    expect(restored.status).toBe("VERIFIED");
    expect([campaign(f), campaign(f, "2")]).toEqual(original);
    expect(f.resources.get(String(created.resourceName))).toBeDefined();
    expect(f.counts()).toMatchObject({ validate_only: 2, write: 2 });
    const journal = object(await f.call("list_change_journal", {}));
    expect(JSON.stringify(journal)).toContain(String(result.commit_id));
    expect(JSON.stringify(journal)).toContain(String(restored.commit_id));
    const writes = f.requests.filter((r) => r.body.validateOnly === false);
    expect(writes.every((r) => r.body.partialFailure === false)).toBe(true);
    for (const r of writes)
      for (const op of r.body.mutateOperations as Record<string, unknown>[]) {
        if (op.campaignOperation)
          expect(object(op.campaignOperation)).toMatchObject({
            updateMask: "campaign_budget",
          });
      }
    const inverse = object(
      await f.mcp.call(principal, "preview_rollback_commit", {
        commit_id: restored.commit_id,
      }),
    );
    expect(inverse.status).toBe("preview");
    await expect(commit(f, inverse)).rejects.toThrow();
    expect(f.counts().write).toBe(2);
  });
  it("consumed preview cannot create another budget or reuse approval", async () => {
    const f = fixture(),
      p = await preview(f);
    await f.approve(p);
    expect(object(await commit(f, p)).status).toBe("VERIFIED");
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });
  it("new shared consumer after preview is stale before any mutation and rejection audited", async () => {
    const f = fixture(),
      p = await preview(f);
    await f.approve(p);
    f.resources.set(`${prefix}/campaigns/3`, {
      campaign: {
        ...structuredClone(campaign(f)),
        id: "3",
        resourceName: `${prefix}/campaigns/3`,
      },
    });
    await expect(commit(f, p)).rejects.toThrow(/stale/i);
    expect(f.counts().write).toBe(0);
    expect(f.events.some((e) => object(e.metadata).result === "rejected")).toBe(
      true,
    );
  });
  it("expired approval and changed immutable payload reject with zero mutations", async () => {
    const f = fixture(),
      p = await preview(f);
    await f.approve(p);
    f.previewsRows[0]!.expiresAt = new Date(0);
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    const g = fixture(),
      q = await preview(g);
    await g.approve(q);
    const plan = object(g.previewsRows[0]!.requestedState);
    object(
      (plan.operations as Record<string, unknown>[])[1]!.fields,
    ).campaignBudget = `${prefix}/campaignBudgets/21`;
    await expect(commit(g, q)).rejects.toThrow();
    expect(g.counts().write).toBe(0);
  });
  it("real account / false TEST proof and foreign target fail before validate_only", async () => {
    const f = fixture();
    object(
      f.resources.get(`${prefix}/customers/${prefix.split("/")[1]}`)?.customer,
    ).testAccount = false;
    await expect(preview(f)).rejects.toThrow(/TEST/i);
    expect(f.counts()).toMatchObject({ validate_only: 0, write: 0 });
    const g = fixture();
    campaign(g, "2").resourceName = "customers/9999999999/campaigns/2";
    await expect(preview(g)).rejects.toThrow();
    expect(g.counts().write).toBe(0);
  });
  it("atomic Google validation failure creates no preview or budget", async () => {
    const f = fixture();
    f.failOperation(1);
    expect(await preview(f)).toMatchObject({
      status: "validation_failed",
      provider_validation: "failed",
      provider_mutation_sent: false,
    });
    expect(f.previewsRows).toHaveLength(0);
    expect(f.counts()).toMatchObject({ validate_only: 1, write: 0 });
    expect(campaign(f).campaignBudget).toBe(`${prefix}/campaignBudgets/20`);
  });
  it("one failed atomic approved mutate does not partially assign or trigger retry", async () => {
    const f = fixture(),
      p = await preview(f),
      before = structuredClone([campaign(f), campaign(f, "2")]);
    await f.approve(p);
    f.failOperation(1);
    const result = object(await commit(f, p));
    expect(result.status).not.toBe("VERIFIED");
    expect([campaign(f), campaign(f, "2")]).toEqual(before);
    expect(f.counts().write).toBe(1);
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });
  it("private tools have truthful metadata and are absent from Public MCP", () => {
    const f = fixture(),
      item = f.mcp.tools().find((t) => t.name === tool)!;
    expect(item).toBeDefined();
    expect(item.description).toContain("TEST-only");
    expect(item.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(publicTools(f.mcp.tools()).map((t) => String(t.name))).not.toContain(
      tool,
    );
    const pmax = f.mcp
      .tools()
      .find((t) => t.name === "google_ads_pmax_preview")!;
    expect(pmax.description).toContain("non-retail");
    expect(pmax.description).not.toContain(
      "Full PMax creation, binary ingestion and unsupported brand/minimum-asset profiles explicitly rejected",
    );
  });
});
