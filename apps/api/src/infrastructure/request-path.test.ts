import { describe, expect, it } from "vitest";
import { requestPath } from "./request-path.js";

describe("requestPath", () => {
  it("removes callback query parameters from structured logs", () => {
    expect(
      requestPath("/oauth/google/callback?state=redacted&code=redacted"),
    ).toBe("/oauth/google/callback");
  });

  it("keeps an ordinary pathname unchanged", () => {
    expect(requestPath("/health")).toBe("/health");
  });

  it("does not log an approval nonce even on a malformed legacy URL", () => {
    expect(
      requestPath("/api/v1/mcp/public/approval?approval_nonce=hmap_secret"),
    ).toBe("/api/v1/mcp/public/approval");
  });
});
