import { createHmac, timingSafeEqual } from "node:crypto";

type CursorPurpose =
  | "campaigns"
  | "keywords"
  | "negatives"
  | "negative-conflicts"
  | "search-terms";

type CursorPayload = Record<string, unknown>;

function signature(
  payload: string,
  secret: string,
  purpose: CursorPurpose,
): Buffer {
  return createHmac("sha256", secret)
    .update(`google-${purpose}:v1:`)
    .update(payload)
    .digest();
}

export function encodeGoogleCursor(
  position: CursorPayload,
  context: string,
  secret: string,
  purpose: CursorPurpose,
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...position, v: 1, f: context }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret, purpose).toString("base64url")}`;
}

// Callers validate their own position fields and map failures to a typed error.
export function decodeGoogleCursor(
  cursor: string,
  context: string,
  secret: string,
  purpose: CursorPurpose,
): CursorPayload {
  if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor))
    throw new Error("Invalid cursor encoding.");
  const [payload, mac] = cursor.split(".") as [string, string];
  const supplied = Buffer.from(mac, "base64url");
  const expected = signature(payload, secret, purpose);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Error("Invalid cursor signature.");
  const decoded: unknown = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    throw new Error("Invalid cursor payload.");
  const value = decoded as CursorPayload;
  if (value.v !== 1 || value.f !== context)
    throw new Error("Cursor context mismatch.");
  return value;
}
