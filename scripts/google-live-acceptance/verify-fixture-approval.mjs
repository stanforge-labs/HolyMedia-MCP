// Pure approval view test. Never submits a decision or a commit.
import { readFileSync } from "node:fs";
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const db = createDatabase(process.env.DATABASE_URL);
try {
  const context = JSON.parse(
      readFileSync("/acceptance-state/fixture-context.json", "utf8"),
    ),
    preview = context.preview;
  if (
    preview?.status !== "preview" ||
    preview.provider_validation !== "passed" ||
    preview.partial_failure !== false
  )
    throw new Error("validated_preview_missing");
  const stored = await db.client.mcpPreview.findUnique({
    where: { id: preview.preview_id },
    select: {
      confirmedAt: true,
      consumedAt: true,
      approvedByUserId: true,
      cancelledAt: true,
      expiresAt: true,
      requestedState: true,
    },
  });
  if (
    !stored ||
    stored.confirmedAt ||
    stored.consumedAt ||
    stored.approvedByUserId ||
    stored.cancelledAt ||
    stored.expiresAt <= new Date()
  )
    throw new Error("preview_not_pending_stop");
  const headers = { host: "localhost:4400", origin: "http://localhost:4400" },
    root = "http://127.0.0.1:4001";
  for (const path of [
    "/mcp/approve",
    "/acceptance/approval.mjs",
    "/acceptance/approval.css",
    "/health",
    "/ready",
  ]) {
    if ((await fetch(root + path, { headers })).status !== 200)
      throw new Error("approval_asset_or_health_failed");
  }
  const session = await fetch(root + "/acceptance/session", {
    method: "POST",
    headers,
  });
  if (!session.ok) throw new Error("approval_session_failed");
  const csrf = (await session.json()).csrfToken,
    cookie = session.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
  const view = await fetch(root + "/api/v1/mcp/public/approval/view", {
    method: "POST",
    headers: {
      ...headers,
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      approval_nonce: new URL(preview.approval_url).hash.slice(1),
    }),
  });
  if (!view.ok) throw new Error("real_holymedia_approval_view_failed");
  const value = await view.json();
  if (
    value.approved ||
    value.operation !== "campaign_create" ||
    value.stage1_items?.length !== preview.operation_count
  )
    throw new Error("approval_plan_mismatch");
  console.log(
    JSON.stringify({
      approval_page: "PASS",
      actual_holymedia_approval_view: "PASS",
      pending_not_approved: true,
      planned_operations: preview.operation_count,
      expires_at: preview.expires_at,
      provider_writes: 0,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      result: "BLOCKED",
      code: /^[a-z_]+$/.test(error.message)
        ? error.message
        : "approval_verification_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDatabase(db);
}
