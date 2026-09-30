import { describe, expect, it } from "vitest";
import { McpService, V1_COMPATIBLE_MCP_TOOLS } from "./mcp.service.js";
import {
  PUBLIC_READ_TOOLS,
  PUBLIC_TOOL_NAMES,
  PUBLIC_WRITE_TOOLS,
  isPublicTool,
  publicTools,
} from "./mcp-public-tools.js";

const descriptors = McpService.prototype.tools.call({} as McpService);

describe("public MCP tool registry", () => {
  it("keeps the legacy 157-tool contract and exposes exactly the reviewed 43", () => {
    expect(V1_COMPATIBLE_MCP_TOOLS).toHaveLength(157);
    expect(PUBLIC_READ_TOOLS).toHaveLength(38);
    expect(PUBLIC_WRITE_TOOLS).toHaveLength(5);
    const listed = publicTools(descriptors);
    expect(listed.map((tool) => tool.name)).toEqual([...PUBLIC_TOOL_NAMES]);
    expect(new Set(listed.map((tool) => tool.name)).size).toBe(43);
    for (const hidden of [
      "commit_preview",
      "commit_meta_app_review_preview",
      "commit_meta_confirmed_write",
      "preview_change_campaign_budget",
      "preview_meta_update_campaign",
      "list_operator_skills",
      "analyze_site",
    ]) {
      expect(isPublicTool(hidden)).toBe(false);
      expect(listed.some((tool) => tool.name === hidden)).toBe(false);
    }
  });

  it("requires all annotations and classifies actual side effects", () => {
    for (const tool of publicTools(descriptors)) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations.title).toBeTruthy();
      for (const key of [
        "readOnlyHint",
        "destructiveHint",
        "openWorldHint",
        "idempotentHint",
      ] as const)
        expect(typeof tool.annotations[key], `${tool.name}.${key}`).toBe(
          "boolean",
        );
      if (PUBLIC_READ_TOOLS.includes(tool.name as never)) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        });
      }
    }
    const byName = new Map(
      publicTools(descriptors).map((tool) => [tool.name, tool]),
    );
    for (const name of PUBLIC_WRITE_TOOLS.slice(0, 3)) {
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      });
    }
    expect(byName.get("confirm_preview")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    });
    expect(byName.get("commit_confirmed_preview")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    });
    expect(
      byName.get("list_connected_resources")?.annotations.openWorldHint,
    ).toBe(false);
    expect(
      byName.get("generate_monthly_ads_report")?.annotations.openWorldHint,
    ).toBe(true);
  });
});
