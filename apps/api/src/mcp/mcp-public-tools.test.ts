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
  it("exposes the reviewed read inventory from the current legacy registry", () => {
    expect(V1_COMPATIBLE_MCP_TOOLS).toEqual(
      expect.arrayContaining([...PUBLIC_READ_TOOLS]),
    );
    expect(PUBLIC_READ_TOOLS).toEqual(
      expect.arrayContaining([
        "google_ads_list_keywords",
        "google_ads_search_terms",
        "google_ads_list_negatives",
        "google_ads_check_negative_conflicts",
      ]),
    );
    expect(PUBLIC_WRITE_TOOLS).toHaveLength(4);
    const listed = publicTools(descriptors);
    expect(listed.map((tool) => tool.name)).toEqual([...PUBLIC_TOOL_NAMES]);
    expect(new Set(listed.map((tool) => tool.name)).size).toBe(
      PUBLIC_TOOL_NAMES.length,
    );
    for (const hidden of [
      "confirm_preview",
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
      if (
        PUBLIC_READ_TOOLS.includes(tool.name as never) &&
        tool.name !== "run_connection_diagnostics"
      ) {
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
    expect(byName.get("run_connection_diagnostics")?.annotations).toMatchObject(
      {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
    );
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
