import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  validateInlineMedia,
  safeMediaSummary,
  mediaMetadata,
  GOOGLE_MEDIA_LIMITS,
} from "./google-ads-media.js";
const image = async (width = 600, height = 314, jpeg = false) => {
  const s = sharp({
    create: { width, height, channels: 3, background: "#1274a2" },
  });
  const bytes = await (jpeg ? s.jpeg().withMetadata() : s.png()).toBuffer();
  return {
    mime_type: jpeg ? "image/jpeg" : "image/png",
    data_base64: bytes.toString("base64"),
  };
};
describe("safe actual Google image ingestion (no provider calls)", () => {
  it.each([false, true])(
    "fully decodes pixels and strips metadata, JPEG=%s",
    async (jpeg) => {
      const input = await image(600, 314, jpeg),
        result = await validateInlineMedia(input);
      expect(result).toMatchObject({
        width: 600,
        height: 314,
        mime_type: input.mime_type,
      });
      const actual = await sharp(
        Buffer.from(result.data_base64, "base64"),
      ).metadata();
      expect(actual.exif).toBeUndefined();
      expect(actual.icc).toBeUndefined();
      expect(result.byte_length).toBe(
        Buffer.from(result.data_base64, "base64").length,
      );
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(mediaMetadata(result)).not.toHaveProperty("data_base64");
    },
  );
  it("rejects truncated actual pixels even with valid signature", async () => {
    const good = await image();
    good.data_base64 = Buffer.from(good.data_base64, "base64")
      .subarray(0, 90)
      .toString("base64");
    await expect(validateInlineMedia(good)).rejects.toThrow(/decode/);
  });
  it("rejects MIME mismatch, remote/path/dataURI/raw provider objects", async () => {
    const good = await image();
    await expect(
      validateInlineMedia({ ...good, mime_type: "image/jpeg" }),
    ).rejects.toThrow(/MIME/);
    for (const raw of [
      { url: "https://example.com/a.png" },
      { path: "C:/secret.png" },
      { ...good, data_base64: "data:image/png;base64," + good.data_base64 },
      { ...good, resourceName: "customers/1/assets/2" },
    ])
      await expect(validateInlineMedia(raw)).rejects.toThrow();
  });
  it("rejects noncanonical base64 and over-limit bytes without recursive regex", async () => {
    for (const text of [
      "Zh==",
      "abcd===",
      "AAAA\n",
      Buffer.alloc(GOOGLE_MEDIA_LIMITS.bytes + 1).toString("base64"),
    ])
      await expect(
        validateInlineMedia({ mime_type: "image/png", data_base64: text }),
      ).rejects.toThrow();
  });
  it("rejects oversize dimensions from real image metadata", async () => {
    await expect(validateInlineMedia(await image(4097, 1))).rejects.toThrow(
      /dimensions/,
    );
  });
  it("redacts recursively all inline/raw transport bytes without mutating snapshot", async () => {
    const raw = await image(),
      plan = {
        intent: { brief: { media: raw } },
        operations: [{ fields: { imageAsset: { data: raw.data_base64 } } }],
      };
    const safe = safeMediaSummary(plan);
    expect(JSON.stringify(safe)).not.toContain(raw.data_base64);
    expect(plan.operations[0]!.fields.imageAsset.data).toBe(raw.data_base64);
    expect(safe).toMatchObject({
      operations: [{ fields: { imageAsset: { data: { redacted: true } } } }],
    });
    expect(
      safeMediaSummary({ message: "Provider context: " + raw.data_base64 }),
    ).toEqual({ message: "Provider context: [REDACTED_MEDIA_BASE64]" });
    expect(safeMediaSummary(raw.data_base64)).toBe("[REDACTED_MEDIA_BASE64]");
  });
});
