import { createHash } from "node:crypto";
import sharp from "sharp";
import { extClosed, extFail, extRow } from "./google-ads-extended-plan.js";

export const GOOGLE_MEDIA_LIMITS = {
  bytes: 1024 * 1024,
  aggregateBytes: 2 * 1024 * 1024,
  files: 8,
  pixels: 16_777_216,
  dimension: 4096,
} as const;
export type ValidatedGoogleMedia = {
  data_base64: string;
  mime_type: "image/png" | "image/jpeg";
  width: number;
  height: number;
  byte_length: number;
  sha256: string;
};
export async function validateInlineMedia(
  value: unknown,
): Promise<ValidatedGoogleMedia> {
  const input = extClosed(
    value,
    ["mime_type", "data_base64"],
    ["mime_type", "data_base64"],
  );
  if (
    !["image/png", "image/jpeg"].includes(String(input.mime_type)) ||
    typeof input.data_base64 !== "string" ||
    input.data_base64.length > Math.ceil(GOOGLE_MEDIA_LIMITS.bytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data_base64) ||
    !input.data_base64.length ||
    input.data_base64.length % 4 !== 0
  )
    extFail(
      "google_media_invalid",
      "Требуется ограниченный inline base64 PNG/JPEG, без data URI, URL, file path или произвольных provider fields.",
    );
  const bytes = Buffer.from(input.data_base64, "base64");
  if (
    !bytes.length ||
    bytes.length > GOOGLE_MEDIA_LIMITS.bytes ||
    bytes.toString("base64") !== input.data_base64
  )
    extFail(
      "google_media_size_invalid",
      "Image base64 неканоничен или превышает local 1 MiB profile; Google допускает больше, это безопасный лимит HolyMedia.",
    );
  const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    (input.mime_type === "image/png" && !png) ||
    (input.mime_type === "image/jpeg" && !jpeg)
  )
    extFail(
      "google_media_mime_mismatch",
      "Declared MIME не совпадает с actual PNG/JPEG signature.",
    );
  if (png) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        type = bytes.toString("ascii", offset + 4, offset + 8);
      if (["acTL", "fcTL", "fdAT"].includes(type))
        extFail(
          "google_media_animation_unsupported",
          "Animated PNG не поддержан: требуется статическое JPEG/PNG.",
        );
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
      if (type === "IEND") break;
    }
  }
  try {
    const decoder = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: GOOGLE_MEDIA_LIMITS.pixels,
      animated: false,
    });
    const metadata = await decoder.metadata();
    if (
      !["png", "jpeg"].includes(String(metadata.format)) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > GOOGLE_MEDIA_LIMITS.dimension ||
      metadata.height > GOOGLE_MEDIA_LIMITS.dimension ||
      metadata.width * metadata.height > GOOGLE_MEDIA_LIMITS.pixels
    )
      extFail(
        "google_media_dimensions_invalid",
        "Требуется one-frame PNG/JPEG с dimensions <=4096 и <=16M pixels.",
      );
    // Full decode and re-encode remove EXIF/ICC/XMP/trailing payloads; metadata alone
    // is not accepted as proof that truncated or malformed pixels are readable.
    const result = await (
      input.mime_type === "image/png"
        ? decoder.rotate().png()
        : decoder.rotate().jpeg({ quality: 90 })
    ).toBuffer({ resolveWithObject: true });
    if (
      result.data.length > GOOGLE_MEDIA_LIMITS.bytes ||
      result.info.width > GOOGLE_MEDIA_LIMITS.dimension ||
      result.info.height > GOOGLE_MEDIA_LIMITS.dimension
    )
      extFail(
        "google_media_size_invalid",
        "Normalized image exceeds safe Google media bounds.",
      );
    return {
      data_base64: result.data.toString("base64"),
      mime_type: input.mime_type as ValidatedGoogleMedia["mime_type"],
      width: result.info.width,
      height: result.info.height,
      byte_length: result.data.length,
      sha256: createHash("sha256").update(result.data).digest("hex"),
    };
  } catch (e) {
    if (e instanceof Error && e.name === "GoogleAdsWriteError") throw e;
    return extFail(
      "google_media_decode_failed",
      "Actual PNG/JPEG pixels cannot be safely decoded; image bytes are not returned or logged.",
    );
  }
}
export function mediaMetadata(media: ValidatedGoogleMedia) {
  const safe = {
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    byte_length: media.byte_length,
    sha256: media.sha256,
  };
  return safe;
}
/** Use before returning browser/MCP/journal/evidence views, never for transport. */
export function safeMediaSummary(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(
      /(?:iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/=]{64,}/g,
      "[REDACTED_MEDIA_BASE64]",
    );
  if (Array.isArray(value)) return value.map(safeMediaSummary);
  if (!value || typeof value !== "object") return value;
  const input = extRow(value),
    out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if ((key === "data_base64" || key === "data") && typeof entry === "string")
      out[key] = {
        redacted: true,
        base64_characters: entry.length,
        sha256_encoded: createHash("sha256").update(entry).digest("hex"),
      };
    else out[key] = safeMediaSummary(entry);
  }
  return out;
}
