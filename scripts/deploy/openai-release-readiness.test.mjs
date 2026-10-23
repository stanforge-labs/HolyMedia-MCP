import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = readFileSync(
  new URL("./openai-release-readiness.sh", import.meta.url),
  "utf8",
);
const runtimeCheck = script.match(
  /docker exec -u node "\$api_cid" node -e '([\s\S]*?)' >\/dev\/null \|\| fail 'running API public WRITE is not OFF'/,
)?.[1];
const fileCheck = script.match(
  /for flag in PUBLIC_MCP_WRITE_SCOPE_ENABLED PUBLIC_MCP_CONTROLLED_WRITE_ENABLED; do[\s\S]*?\ndone/,
)?.[0];

test("OpenAI gate checks configured and running API public WRITE before release", () => {
  assert.ok(runtimeCheck, "running API check must exist");
  assert.match(
    script,
    /for flag in PUBLIC_MCP_WRITE_SCOPE_ENABLED PUBLIC_MCP_CONTROLLED_WRITE_ENABLED; do/,
  );
  assert.match(script, /\[\[ \$count -le 1 \]\]/);
  assert.match(script, /\[\[ \$\{value,,\} == false \]\]/);
  assert.ok(
    script.indexOf("running API public WRITE is not OFF") <
      script.indexOf("# The additive migration must have been applied"),
  );
});

test("configured public WRITE flags fail closed", () => {
  assert.ok(fileCheck, "config file check must exist");
  const shell = `set -euo pipefail
check() (
  app_env=$(mktemp)
  trap 'rm -f "$app_env"' EXIT
  printf '%b' "$1" > "$app_env"
  fail() { exit 1; }
  ${fileCheck}
)
check ''
check 'PUBLIC_MCP_WRITE_SCOPE_ENABLED=false\nPUBLIC_MCP_CONTROLLED_WRITE_ENABLED=FALSE\n'
if check 'PUBLIC_MCP_WRITE_SCOPE_ENABLED=true\n'; then exit 1; fi
if check 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=true\n'; then exit 1; fi
if check 'PUBLIC_MCP_WRITE_SCOPE_ENABLED=false\nPUBLIC_MCP_WRITE_SCOPE_ENABLED=false\n'; then exit 1; fi
if check 'PUBLIC_MCP_WRITE_SCOPE_ENABLED=off\n'; then exit 1; fi`;
  const command = process.platform === "win32" ? "wsl.exe" : "bash";
  const args =
    process.platform === "win32"
      ? ["--exec", "bash", "-c", shell]
      : ["-c", shell];
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
});

for (const [label, scope, controlled, expected] of [
  ["defaults", undefined, undefined, 0],
  ["explicitly disabled", "false", "FALSE", 0],
  ["scope enabled", "true", "false", 1],
  ["controlled writes enabled", "false", "true", 1],
  ["ambiguous value", "off", "false", 1],
]) {
  test(`running API public WRITE: ${label}`, () => {
    const env = { ...process.env };
    for (const [name, value] of [
      ["PUBLIC_MCP_WRITE_SCOPE_ENABLED", scope],
      ["PUBLIC_MCP_CONTROLLED_WRITE_ENABLED", controlled],
    ]) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    const result = spawnSync(process.execPath, ["-e", runtimeCheck], { env });
    assert.equal(result.status, expected);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
  });
}
