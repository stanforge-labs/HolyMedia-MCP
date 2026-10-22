import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { human, object, principal } from "./google-write-test.fixture.js";
describe("Binary media uses stock immutable approval flow without leaking bytes", () => {
  it("exact transport retained; MCP/browser/audit/journal receive only safe metadata", async () => {
    const f = extendedFixture();
    const bytes = await sharp({
      create: { width: 1200, height: 1200, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const encoded = bytes.toString("base64");
    const p = await f.call("google_ads_ads_assets_preview", {
      action: "image_asset_create",
      items: [
        {
          level: "campaign",
          campaign_id: "1",
          field_type: "AD_IMAGE",
          media: { mime_type: "image/png", data_base64: encoded },
        },
      ],
    });
    expect(p.status).toBe("preview");
    expect(p.atomic).toBe(true);
    expect(f.counts().validate_only).toBe(1);
    expect(f.counts().write).toBe(0);
    const stored = f.previewsRows.find((row) => row.id === p.preview_id)!;
    const plan = object(stored.requestedState);
    const operations = plan.operations as Record<string, unknown>[];
    const data = String(object(object(operations[0]!.fields).imageAsset).data);
    expect(data).toMatch(/^iVBORw0KGgo/);
    expect(JSON.stringify(p)).not.toContain(data);
    expect(JSON.stringify(p)).not.toContain(encoded);
    const view = await f.previews.googleApprovalView(
      human,
      String(p.approval_url).split("#")[1]!,
    );
    expect(JSON.stringify(view)).not.toContain(data);
    expect(view).toHaveProperty("exact_mutation_plan");
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    await f.approve(p);
    const committed = object(
      await f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    );
    expect(committed.status).toBe("VERIFIED");
    expect(f.counts().write).toBe(1);
    const journal = await f.mcp.call(principal, "list_change_journal", {
      provider: "GOOGLE_ADS",
      account_id: "1234567890",
    });
    expect(JSON.stringify([committed, journal, f.events])).not.toContain(data);
    expect(JSON.stringify(stored.requestedState)).toContain(data);
    // Redaction never mutates the digest-bound exact provider payload.
    const requests = f.requests.filter(
      (request) => object(request.body).validateOnly === false,
    );
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]!.body)).toContain(data);
  });
});
