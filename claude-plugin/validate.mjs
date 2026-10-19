import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./holypilot/", import.meta.url)));
const originalLogo = resolve(
  fileURLToPath(
    new URL(
      "../apps/web/public/assets/brand/holy-pilot-symbol.svg",
      import.meta.url,
    ),
  ),
);
const skillNames = [
  "campaign-analysis",
  "report-preparation",
  "optimization-opportunities",
  "safe-change-preview",
  "change-verification",
];

function filesBelow(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = join(folder, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function validatePlugin(folder = root, logoSource = originalLogo) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(folder, ".claude-plugin/plugin.json"), "utf8"),
    );
  } catch (error) {
    return [`manifest unavailable or invalid JSON: ${error.message}`];
  }
  expect(manifest.name === "holypilot", "plugin name must be holypilot");
  expect(
    manifest.displayName === "HolyPilot",
    "display name must be HolyPilot",
  );
  expect(
    /^\d+\.\d+\.\d+$/.test(manifest.version ?? ""),
    "version must be semver",
  );
  expect(manifest.author?.name === "HolyMedia", "author must be HolyMedia");
  const servers = manifest.mcpServers ?? {};
  expect(
    Object.keys(servers).length === 1,
    "exactly one remote MCP server expected",
  );
  expect(servers.holypilot?.type === "http", "MCP transport must be http");
  expect(
    servers.holypilot?.url === "https://mcp.holymedia.kz/mcp/public",
    "connector must use the fixed public MCP resource",
  );
  expect(
    !servers.holypilot?.headers &&
      !servers.holypilot?.command &&
      !servers.holypilot?.oauth,
    "bundle must not contain credentials, local commands or an OAuth override",
  );
  for (const key of ["supportUrl", "privacyPolicyUrl", "termsOfServiceUrl"]) {
    expect(
      typeof manifest[key] === "string" &&
        manifest[key].startsWith("https://mcp.holymedia.kz/"),
      `${key} must link to the HolyPilot site`,
    );
  }
  const icon = join(folder, "assets/holy-pilot-symbol.svg");
  expect(
    manifest.icon === "./assets/holy-pilot-symbol.svg",
    "official icon path required",
  );
  try {
    expect(
      sha256(icon) === sha256(logoSource),
      "brand symbol differs from official source",
    );
  } catch (error) {
    failures.push(`official brand symbol unavailable: ${error.message}`);
  }
  for (const name of skillNames) {
    let content;
    try {
      content = readFileSync(join(folder, "skills", name, "SKILL.md"), "utf8");
    } catch (error) {
      failures.push(`${name} skill unavailable: ${error.message}`);
      continue;
    }
    expect(content.startsWith("---\n"), `${name} frontmatter missing`);
    expect(
      new RegExp(`^name: ${name}$`, "m").test(content),
      `${name} name mismatch`,
    );
    expect(/^description: .+$/m.test(content), `${name} description missing`);
    expect(/[А-Яа-яЁё]/u.test(content), `${name} Russian guidance missing`);
  }
  const all = filesBelow(folder);
  const expected = new Set([
    ".claude-plugin/plugin.json",
    "README.md",
    "LICENSE",
    "assets/holy-pilot-symbol.svg",
    ...skillNames.map((name) => `skills/${name}/SKILL.md`),
  ]);
  for (const file of all) {
    const rel = relative(folder, file).replaceAll("\\", "/");
    expect(expected.has(rel), `unexpected publishable file: ${rel}`);
    expect(statSync(file).size < 256 * 1024, `file exceeds 256 KiB: ${rel}`);
    const content = readFileSync(file, "utf8");
    expect(
      !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{20,}|\bAIza[0-9A-Za-z_-]{30,}|\bsk-[A-Za-z0-9]{20,}/.test(
        content,
      ),
      `credential-like material found: ${rel}`,
    );
  }
  for (const rel of expected)
    expect(
      all.some((file) => relative(folder, file).replaceAll("\\", "/") === rel),
      `missing ${rel}`,
    );
  const readme = readFileSync(join(folder, "README.md"), "utf8");
  expect(readme.split(/\s+/).length >= 40, "README too short for directory");
  expect(readme.includes("default-OFF"), "write boundary missing from README");
  return failures;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = validatePlugin();
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("HolyPilot publishable bundle contract: PASS\n");
  }
}
