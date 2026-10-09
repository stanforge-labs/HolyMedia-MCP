import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedRoute, origin } from "./approval-gateway.mjs";
test("approval-only loopback routes do not expose MCP/provider/OAuth or production", () => {
  assert.equal(origin, "http://localhost:4402");
  for (const method of ["POST", "DELETE", "PUT"]) {
    for (const path of [
      "/mcp",
      "/mcp/public",
      "/api/v1/mcp/rest/commit_preview",
      "/oauth/GOOGLE_ADS/callback",
      "/api/v1/workspaces/test/connections/GOOGLE_ADS/oauth/start",
    ])
      assert.equal(allowedRoute(method, path), false);
  }
  assert.equal(allowedRoute("GET", "/mcp/approve"), true);
  assert.equal(allowedRoute("POST", "/api/v1/mcp/public/approval"), true);
  assert.equal(allowedRoute("GET", "/api/v1/mcp/public/approval"), false);
});
