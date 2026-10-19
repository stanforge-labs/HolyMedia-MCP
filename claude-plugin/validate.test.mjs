import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validatePlugin } from "./validate.mjs";

const source = fileURLToPath(new URL("./holypilot/", import.meta.url));
const logo = fileURLToPath(
  new URL(
    "../apps/web/public/assets/brand/holy-pilot-symbol.svg",
    import.meta.url,
  ),
);

test("publishable bundle has the fixed public MCP and exact official mark", () => {
  assert.deepEqual(validatePlugin(source, logo), []);
});

test("rejects accidental private MCP profile or extra publishable file", () => {
  const temp = mkdtempSync(join(tmpdir(), "holypilot-plugin-"));
  try {
    cpSync(source, temp, { recursive: true });
    const manifestFile = join(temp, ".claude-plugin/plugin.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.mcpServers.holypilot.url =
      "https://mcp.holymedia.kz/mcp?profile=google_ads_write";
    writeFileSync(manifestFile, JSON.stringify(manifest));
    writeFileSync(join(temp, "secret.env"), "not-a-real-credential");
    const failures = validatePlugin(temp, logo);
    assert(failures.some((failure) => failure.includes("fixed public MCP")));
    assert(
      failures.some((failure) =>
        failure.includes("unexpected publishable file"),
      ),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
