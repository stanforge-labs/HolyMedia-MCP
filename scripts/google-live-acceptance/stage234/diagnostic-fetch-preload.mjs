// Startup diagnosis only. No Google, OAuth, MCP, approval or other external fetch.
import process from "node:process";
import { URL } from "node:url";
export const healthOnlyFetch =
  (native) =>
  (input, init = {}) => {
    const url = new URL(String(input));
    if (
      url.origin !== "http://127.0.0.1:4000" ||
      String(init.method ?? "GET").toUpperCase() !== "GET" ||
      !["/health", "/ready"].includes(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw Error("stage234_diagnostic_non_health_fetch_blocked");
    return native(input, init);
  };
if (process.env.STAGE234_DIAGNOSTIC_PRELOAD === "1")
  globalThis.fetch = healthOnlyFetch(globalThis.fetch);
