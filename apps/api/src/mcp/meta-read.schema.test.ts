import { describe, it, expect } from "vitest";
import { metaReadSchema } from "./meta-read.schema.js";
describe("published Meta read contracts", () => {
  it("lists Pages without requiring an account or Page id", () => {
    expect(metaReadSchema("list_meta_pages")).toMatchObject({
      required: [],
      additionalProperties: false,
    });
  });
  it("requires external asset IDs for gets", () => {
    expect(metaReadSchema("get_meta_page")).toMatchObject({
      required: ["page_id"],
    });
    expect(metaReadSchema("get_meta_business")).toMatchObject({
      required: ["business_id"],
    });
  });
  it("does not replace shared provider contracts with a Meta-only schema", () => {
    expect(metaReadSchema("get_connected_assets")).toBeUndefined();
    expect(metaReadSchema("get_flexible_insights")).toMatchObject({
      properties: { provider: { type: "string" } },
    });
  });
});
