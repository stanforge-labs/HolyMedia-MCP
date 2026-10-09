import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
const { AbortSignal } = globalThis;
export const LOCAL_STARTUP_BUDGET_MS = 45000;
export async function waitLocalReady({
  fetch,
  server,
  now = () => performance.now(),
  sleep = delay,
}) {
  const deadline = now() + LOCAL_STARTUP_BUDGET_MS;
  while (now() < deadline) {
    if (server.exitCode !== null || server.signalCode)
      throw Error("stage234_commit_stock_api_start_failed");
    try {
      if (
        (
          await fetch("http://127.0.0.1:4000/ready", {
            signal: AbortSignal.timeout(
              Math.min(1000, Math.max(1, Math.ceil(deadline - now()))),
            ),
          })
        ).status === 200
      )
        return true;
    } catch {
      // Health-only startup probes; never a provider or MCP retry.
    }
    if (now() < deadline) await sleep(Math.min(500, deadline - now()));
  }
  return false;
}
