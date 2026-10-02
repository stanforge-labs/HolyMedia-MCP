import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TUNNEL_TARGET = "127.0.0.1:8787";

function targetIsGateway(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return (
      url.protocol === "http:" &&
      url.host === TUNNEL_TARGET &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function assertTunnelTarget(metadata) {
  if (!Array.isArray(metadata?.tunnels) || metadata.tunnels.length === 0)
    throw new Error("TUNNEL TARGET REJECTED");
  const origins = [];
  for (const tunnel of metadata.tunnels) {
    if (
      !targetIsGateway(tunnel?.config?.addr) ||
      tunnel.config.inspect === true
    )
      throw new Error("TUNNEL TARGET REJECTED");
    let publicUrl;
    try {
      publicUrl = new URL(tunnel.public_url);
    } catch {
      throw new Error("TUNNEL METADATA REJECTED");
    }
    if (
      !["http:", "https:"].includes(publicUrl.protocol) ||
      publicUrl.href !== `${publicUrl.origin}/` ||
      publicUrl.hostname.endsWith("holymedia.kz")
    )
      throw new Error("TUNNEL METADATA REJECTED");
    if (publicUrl.protocol === "https:") origins.push(publicUrl.origin);
  }
  if (origins.length !== 1) throw new Error("HTTPS TUNNEL REJECTED");
  return origins[0];
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [mode, metadataPath] = process.argv.slice(2);
  if (!["check", "export"].includes(mode) || !metadataPath) {
    console.error("TUNNEL ASSERTION FAILED");
    process.exit(1);
  }
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const origin = assertTunnelTarget(metadata);
    if (mode === "export") {
      if (!process.env.GITHUB_ENV) throw new Error("MISSING ENV OUTPUT");
      const lines = [
        "TUNNEL_ORIGIN",
        "HOLYMEDIA_PUBLIC_BASE_URL",
        "CORS_ORIGINS",
        "NEXT_PUBLIC_API_BASE_URL",
      ].map((name) => `${name}=${origin}\n`);
      await appendFile(process.env.GITHUB_ENV, lines.join(""));
    }
    console.log("TUNNEL TARGET PASS");
  } catch {
    console.error("TUNNEL ASSERTION FAILED");
    process.exitCode = 1;
  }
}
