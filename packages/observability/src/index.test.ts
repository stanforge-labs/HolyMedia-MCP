import { describe, expect, it } from "vitest";
import { createLogger } from "./index.js";

describe("structured log redaction", () => {
  it("never emits approval, preview, CSRF or cookie values in fields or request objects", () => {
    const secret = "hmap_sensitive_test_nonce";
    const chunks: string[] = [];
    const logger = createLogger("test", "info", {
      write(chunk: string) {
        chunks.push(chunk);
      },
    });
    logger.info({
      approval_nonce: secret,
      nonce: secret,
      preview_token: secret,
      req: {
        body: { approval_nonce: secret },
        headers: { cookie: secret, authorization: secret },
      },
      body: { approval_nonce: secret },
      request: { body: { preview_token: secret } },
      cookie: secret,
      csrfToken: secret,
      headers: { "x-csrf-token": secret },
    });
    const output = chunks.join("");
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
  });
});
