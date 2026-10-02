import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { safePathname } from "./public_mcp_devmode_gateway.mjs";

export function sanitize(source) {
  const safe = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event !== "object" || event === null) continue;
      const method =
        typeof event.method === "string" && /^[A-Z]{2,12}$/.test(event.method)
          ? event.method
          : "EVENT";
      const path =
        typeof event.pathname === "string"
          ? event.pathname
          : typeof event.path === "string"
            ? event.path
            : "/unknown";
      const status =
        Number.isInteger(event.status) &&
        event.status >= 100 &&
        event.status <= 599
          ? event.status
          : null;
      const duration =
        Number.isFinite(event.duration_ms) && event.duration_ms >= 0
          ? Math.round(event.duration_ms)
          : null;
      safe.push(
        JSON.stringify({
          method,
          pathname: safePathname(path),
          status,
          duration_ms: duration,
        }),
      );
    } catch {
      // Never copy unstructured raw logs into an artifact.
    }
  }
  return safe.join("\n") + (safe.length ? "\n" : "");
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [apiSource, gatewaySource, outputDirectory] = process.argv.slice(2);
  if (!apiSource || !gatewaySource || !outputDirectory) {
    console.error("SANITIZED LOG EXPORT FAILED: missing paths");
    process.exit(1);
  }
  try {
    await mkdir(outputDirectory, { recursive: true });
    for (const [source, name] of [
      [apiSource, "api.jsonl"],
      [gatewaySource, "gateway.jsonl"],
    ]) {
      const raw = await readFile(source, "utf8").catch(() => "");
      await writeFile(join(outputDirectory, name), sanitize(raw), {
        mode: 0o600,
      });
    }
    console.log("SANITIZED LOGS READY");
  } catch {
    console.error("SANITIZED LOG EXPORT FAILED");
    process.exitCode = 1;
  }
}
