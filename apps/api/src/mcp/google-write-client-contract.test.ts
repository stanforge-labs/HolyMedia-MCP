import { describe, expect, it } from "vitest";
import { parseStage4Intent } from "../providers/google-ads-stage4.js";
import { validateBriefSchema } from "./mcp-google-stage0-schema.js";
import {
  GOOGLE_WRITE_GENERIC_TOOLS,
  GOOGLE_WRITE_PROFILE_TOOLS,
  googleWriteGenericIntent,
  googleWriteGenericSchema,
  googleWriteOpenApi,
  googleWriteProfileName,
  googleWriteToolProfile,
  type GoogleWriteClientTool,
} from "./google-write-client-contract.js";

const args = {
  provider: "GOOGLE_ADS",
  account_id: "8590146099",
  campaign_id: "24324170853",
};
const registry = (): GoogleWriteClientTool[] => [
  ...GOOGLE_WRITE_PROFILE_TOOLS.map((name) => ({
    name,
    description: name + " existing contract",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { marker: { type: "string" } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  })),
  {
    name: "commit_meta_confirmed_write",
    inputSchema: { type: "object" },
  },
  { name: "google_ads_unregistered_raw_mutate", inputSchema: {} },
  { name: "get_meta_business", inputSchema: {} },
  { name: "confirm_preview", inputSchema: {} },
];

describe("Google generic aliases: required PPC P6/P245–250", () => {
  it.each([
    ["preview_pause_adset_or_group", "PAUSED"],
    ["preview_resume_adset_or_group", "ENABLED"],
  ])("%s maps only group status", (name, status) => {
    const selected = googleWriteGenericIntent(name, {
      ...args,
      ad_group_id: "206587491811",
    })!;
    expect(selected.account_id).toBe(args.account_id);
    expect(selected.intent).toEqual({
      provider: "GOOGLE_ADS",
      account_id: args.account_id,
      action: "ad_group_update",
      items: [
        {
          campaign_id: args.campaign_id,
          ad_group_id: "206587491811",
          status,
        },
      ],
    });
    expect(parseStage4Intent(selected.intent)).toEqual(selected.intent);
  });
  it("rename preserves supplied name with no hidden status or Google fields", () => {
    const input = { ...args, new_name: " Новое имя кампании " };
    const snapshot = structuredClone(input);
    const result = googleWriteGenericIntent(
      "preview_change_campaign_name",
      input,
    )!;
    expect(input).toEqual(snapshot);
    expect(result.intent.items).toEqual([
      { campaign_id: args.campaign_id, name: input.new_name },
    ]);
    expect(parseStage4Intent(result.intent)).toEqual(result.intent);
  });
  it.each([
    {},
    { ...args },
    { ...args, new_name: "   " },
    { ...args, new_name: "a".repeat(256) },
    { ...args, new_name: "a\nb" },
    { ...args, provider: "META_ADS", new_name: "safe" },
    { ...args, provider: "google_ads", new_name: "safe" },
    { ...args, provider: undefined, new_name: "safe" },
    { ...args, account_id: "859-014-6099", new_name: "safe" },
    { ...args, campaign_id: "1 OR 1=1", new_name: "safe" },
    { ...args, campaign_id: 1, new_name: "safe" },
    { ...args, new_name: "safe", status: "ENABLED" },
    { ...args, new_name: "safe", request: { campaign: { status: "ENABLED" } } },
    { ...args, new_name: "safe", __proto__: null, unknown: true },
  ])("rejects missing/foreign/unbounded input: %j", (input) => {
    expect(() =>
      googleWriteGenericIntent("preview_change_campaign_name", input),
    ).toThrow();
  });
  it("rejects group aliases lacking parent and caller-supplied status", () => {
    expect(() =>
      googleWriteGenericIntent("preview_pause_adset_or_group", args),
    ).toThrow();
    expect(() =>
      googleWriteGenericIntent("preview_pause_adset_or_group", {
        ...args,
        ad_group_id: "2",
        status: "ENABLED",
      }),
    ).toThrow();
  });
  it("unknown alias does not invoke a generic fallback", () => {
    expect(
      googleWriteGenericSchema("preview_raw_google_request"),
    ).toBeUndefined();
    expect(
      googleWriteGenericIntent("preview_raw_google_request", {}),
    ).toBeNull();
  });
  it.each(GOOGLE_WRITE_GENERIC_TOOLS)(
    "%s has closed typed field descriptions",
    (name) => {
      const schema = googleWriteGenericSchema(name)!;
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties!.provider!.enum).toEqual(["GOOGLE_ADS"]);
      expect(schema.required).toContain("provider");
      for (const value of Object.values(schema.properties!))
        expect(value.description).toBeTruthy();
      expect(() =>
        validateBriefSchema({ ...args, arbitrary: true }, schema),
      ).toThrow();
    },
  );
});

describe("Google private profile: required PPC P47–53", () => {
  it("selects an explicit bounded unique profile, never broad Google prefixes", () => {
    const all = registry();
    const snapshot = structuredClone(all);
    const profile = googleWriteToolProfile(all);
    expect(profile).toHaveLength(GOOGLE_WRITE_PROFILE_TOOLS.length);
    expect(profile.length).toBeLessThanOrEqual(50);
    expect(new Set(profile.map((tool) => tool.name)).size).toBe(profile.length);
    expect(profile.every((tool) => !tool.name.includes("meta"))).toBe(true);
    expect(profile.some((tool) => tool.name.includes("raw_mutate"))).toBe(
      false,
    );
    expect(profile.some((tool) => tool.name === "confirm_preview")).toBe(false);
    expect(all).toEqual(snapshot);
  });
  it("adds truthful read/commit/remove/rollback hints without changing schema", () => {
    const profile = googleWriteToolProfile(registry());
    for (const name of [
      "get_campaign_structure",
      "google_ads_audience_search",
      "list_change_journal",
    ])
      expect(
        profile.find((tool) => tool.name === name)!.annotations,
      ).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    for (const name of [
      "commit_preview",
      "preview_rollback_commit",
      "preview_delete_or_archive_object",
    ])
      expect(
        profile.find((tool) => tool.name === name)!.annotations,
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    expect(
      profile.find((tool) => tool.name === "google_ads_targeting_preview")!
        .annotations!.readOnlyHint,
    ).toBe(false);
    expect(profile[0]!.inputSchema).toEqual(registry()[0]!.inputSchema);
  });
  it("does not add tools absent from the authenticated registry", () => {
    expect(googleWriteToolProfile([])).toEqual([]);
    expect(
      googleWriteToolProfile([{ name: "get_meta_business", inputSchema: {} }]),
    ).toEqual([]);
  });
  it("rejects duplicate approved tools and unbounded registries", () => {
    const tool = registry()[0]!;
    expect(() => googleWriteToolProfile([tool, tool])).toThrow();
    expect(() => googleWriteToolProfile(Array(1001).fill(tool))).toThrow();
  });
  it.each([null, "", "google_ads_read", "meta", ["google_ads_write"], {}])(
    "unknown profile fails closed: %j",
    (profile) => {
      expect(() => googleWriteProfileName(profile)).toThrow();
    },
  );
  it("accepts exact profile and absent legacy route selector only", () => {
    expect(googleWriteProfileName("google_ads_write")).toBe("google_ads_write");
    expect(googleWriteProfileName(undefined)).toBeUndefined();
  });
});

describe("OpenAPI same-tool REST contract", () => {
  it("one distinct authenticated path per profile tool uses exact schemas", () => {
    const tools = registry();
    const before = structuredClone(tools);
    const api = googleWriteOpenApi(tools, "https://mcp.example.test");
    expect(api.openapi).toBe("3.1.0");
    expect(api.security).toEqual([{ bearerAuth: [] }]);
    expect(api.components).toEqual({
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    });
    const paths = api.paths as Record<
      string,
      { post: Record<string, unknown> }
    >;
    expect(Object.keys(paths)).toHaveLength(GOOGLE_WRITE_PROFILE_TOOLS.length);
    for (const tool of googleWriteToolProfile(tools)) {
      const route = paths[`/api/v1/mcp/rest/${tool.name}`]!.post;
      expect(route.operationId).toBe(tool.name);
      expect(route.requestBody).toEqual({
        required: true,
        content: { "application/json": { schema: tool.inputSchema } },
      });
      expect(route.responses).toHaveProperty("401");
      expect(route.responses).toHaveProperty("403");
    }
    expect(tools).toEqual(before);
    const first = Object.values(paths)[0]!.post.requestBody as {
      content: { "application/json": { schema: Record<string, unknown> } };
    };
    first.content["application/json"].schema.type = "modified";
    expect(tools[0]!.inputSchema.type).toBe("object");
    expect(JSON.stringify(api)).not.toContain("commit_meta_confirmed_write");
  });
  it("documents both structured data and portable text, never execution", () => {
    const api = googleWriteOpenApi([], "http://localhost:4401");
    expect(api.paths).toEqual({});
    expect(api.servers).toEqual([{ url: "http://localhost:4401" }]);
    const single = googleWriteOpenApi(
      [registry()[0]!],
      "https://mcp.example.test",
    );
    expect(JSON.stringify(single)).toContain("structuredContent");
    expect(JSON.stringify(single)).toContain('"const":"text"');
    expect(JSON.stringify(single)).not.toContain("apiKey");
  });
  it.each([
    "not a URL",
    "https://secret@example.test",
    "https://example.test?token=hidden",
    "https://example.test/#hidden",
    "https://example.test/api/v1",
    "http://example.test",
    "file:///tmp/openapi",
  ])("rejects unsafe server origin %s", (base) => {
    expect(() => googleWriteOpenApi([], base)).toThrow();
  });
});
