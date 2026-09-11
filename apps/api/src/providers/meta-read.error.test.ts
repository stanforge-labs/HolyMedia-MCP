import { describe, it, expect } from "vitest";
import { ProviderError } from "./provider.errors.js";
import { metaReadError } from "./meta-read.error.js";
describe("Meta safe read errors", () => {
  it.each([
    ["190", "meta_reauth_required"],
    ["10", "meta_permission_missing"],
    ["4", "meta_rate_limited"],
  ])("maps upstream %s", (upstream, code) => {
    const error = metaReadError(
      new ProviderError(
        "provider_response_invalid",
        "secret upstream content",
        false,
        "400",
        upstream,
        "123",
      ),
      "list_meta_pages",
    );
    expect(error.publicResult()).toMatchObject({
      code,
      provider: "META_ADS",
      operation: "list_meta_pages",
      upstream_code: upstream,
      upstream_subcode: "123",
    });
    expect(JSON.stringify(error.publicResult())).not.toContain(
      "secret upstream content",
    );
  });
  it("does not expose unknown exceptions", () => {
    expect(
      JSON.stringify(
        metaReadError(
          new Error("Bearer secret"),
          "list_meta_pages",
        ).publicResult(),
      ),
    ).not.toContain("Bearer");
  });
});
