import { describe, expect, it, vi } from "vitest";
import { McpController } from "./mcp.controller.js";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { principal, prefix, object } from "./google-write-test.fixture.js";

function response() {
  const reply = { code: vi.fn(), header: vi.fn(), send: vi.fn() };
  reply.code.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  return reply;
}
function controller(mcp: unknown) {
  return new McpController(
    mcp as never,
    { authenticate: vi.fn().mockResolvedValue(principal) } as never,
    { authenticate: vi.fn() } as never,
    { consumeMcpRequest: vi.fn() } as never,
    { record: vi.fn() } as never,
    { call: vi.fn() } as never,
  );
}
describe("Private Google subset and REST reuse the stock controlled lifecycle", () => {
  it("reused generic rename is validate-only, immutable and still requires human approval", async () => {
    const f = extendedFixture();
    const preview = object(
      await f.mcp.callGoogleWriteProfile(
        principal,
        "preview_change_campaign_name",
        {
          provider: "GOOGLE_ADS",
          account_id: "1234567890",
          campaign_id: "1",
          new_name: "Safe TEST rename",
        },
      ),
    );
    expect(preview.status).toBe("preview");
    expect(f.counts().validate_only).toBe(1);
    expect(f.counts().write).toBe(0);
    await expect(
      f.mcp.callGoogleWriteProfile(principal, "commit_preview", {
        preview_token: preview.preview_token,
      }),
    ).rejects.toThrow();
    await f.approve(preview);
    const committed = object(
      await f.mcp.callGoogleWriteProfile(principal, "commit_preview", {
        preview_token: preview.preview_token,
      }),
    );
    expect(committed.status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name,
    ).toBe("Safe TEST rename");
    expect(f.counts().write).toBe(1);
  });
  it("generic group status maps to the owned group only; Meta/default branch cannot enter Google profile", async () => {
    const f = extendedFixture();
    const p = object(
      await f.mcp.callGoogleWriteProfile(
        principal,
        "preview_resume_adset_or_group",
        {
          provider: "GOOGLE_ADS",
          account_id: "1234567890",
          campaign_id: "1",
          ad_group_id: "10",
        },
      ),
    );
    expect(JSON.stringify(p.items)).toContain("ENABLED");
    for (const args of [{ provider: "META_ADS" }, {}])
      await expect(
        f.mcp.callGoogleWriteProfile(
          principal,
          "preview_change_campaign_name",
          args,
        ),
      ).rejects.toThrow();
    await expect(
      f.mcp.callGoogleWriteProfile(principal, "confirm_preview", {}),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    const tools = f.mcp.googleWriteTools();
    expect(tools.length).toBeLessThanOrEqual(50);
    expect(tools.some((tool) => tool.name === "confirm_preview")).toBe(false);
    const rename = tools.find(
      (tool) => tool.name === "preview_change_campaign_name",
    )!;
    expect(rename.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["provider", "account_id", "campaign_id", "new_name"],
    });
  });
  it("opaque Meta preview cannot be committed through a Google-only profile", async () => {
    const f = extendedFixture();
    const p = object(
      await f.call("google_ads_ads_assets_preview", {
        action: "campaign_update",
        items: [{ campaign_id: "1", name: "rename" }],
      }),
    );
    const row = f.previewsRows.find((entry) => entry.id === p.preview_id)!;
    row.provider = "META_ADS";
    await expect(
      f.mcp.callGoogleWriteProfile(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("tools/list profile selection is authenticated, closed and leaves default registry unchanged", async () => {
    const mcp = {
      tools: vi.fn().mockReturnValue([{ name: "legacy" }]),
      googleWriteTools: vi.fn().mockReturnValue([{ name: "google" }]),
    };
    const c = controller(mcp);
    const request = {
      headers: { authorization: "Bearer fixture-private" },
      query: { profile: "google_ads_write" },
      body: { id: 1, method: "tools/list" },
    };
    expect(await c.post(request as never, response() as never)).toMatchObject({
      result: { tools: [{ name: "google" }] },
    });
    expect(
      await c.post({ ...request, query: {} } as never, response() as never),
    ).toMatchObject({ result: { tools: [{ name: "legacy" }] } });
    expect(
      await c.post(
        { ...request, query: { profile: "unknown" } } as never,
        response() as never,
      ),
    ).toMatchObject({ error: { code: -32602 } });
  });
  it("REST dispatch has the exact stock Google MCP flow; never a second mutation path", async () => {
    const mcp = {
      callGoogleWriteProfile: vi.fn().mockResolvedValue({
        provider: "GOOGLE_ADS",
        operation_count: 1,
        status: "preview",
      }),
      call: vi.fn(),
    };
    const c = controller(mcp);
    const args = {
      provider: "GOOGLE_ADS",
      account_id: "1234567890",
      campaign_id: "1",
      new_name: "rename",
    };
    const result = await c.rest(
      {
        headers: { authorization: "Bearer fixture-private" },
        params: { tool: "preview_change_campaign_name" },
        body: args,
      } as never,
      response() as never,
    );
    expect(result).toHaveProperty("structuredContent.status", "preview");
    expect(mcp.callGoogleWriteProfile).toHaveBeenCalledWith(
      principal,
      "preview_change_campaign_name",
      args,
    );
    expect(mcp.call).not.toHaveBeenCalled();
  });
});
