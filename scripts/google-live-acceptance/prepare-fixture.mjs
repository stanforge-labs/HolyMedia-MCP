// Actual HTTP legacy MCP Stage 0 preview. No approval or commit call exists here.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const { verifyPreviewGate } = await import("/acceptance/guard.mjs");
const api = "http://127.0.0.1:4000",
  origin = "http://localhost:4400";
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { CredentialVaultService } =
  await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
const { GoogleAdsAdapter } =
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const { providerJson } =
  await import("/workspace/apps/api/dist/providers/provider-http.js");
const db = createDatabase(process.env.DATABASE_URL);
let stage = "gate",
  fixtureName;
const safe = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/.test(value)
    ? value
    : null;
try {
  verifyPreviewGate();
  const existing = existsSync("/acceptance-state/fixture-context.json")
    ? JSON.parse(readFileSync("/acceptance-state/fixture-context.json", "utf8"))
    : null;
  if (existing?.preview?.status === "preview") {
    const previous = await db.client.mcpPreview.findUnique({
      where: { id: existing.preview.preview_id },
      select: { expiresAt: true, consumedAt: true, commitAttemptedAt: true },
    });
    if (!previous || previous.consumedAt || previous.commitAttemptedAt)
      throw new Error("previous_preview_committed_or_unavailable_stop");
    if (previous.expiresAt > new Date())
      throw new Error("preview_already_prepared_stop");
    // Rebuild through the actual MCP tool. Never extend/reset the old record,
    // approval nonce or snapshot; Google must validate the new preview again.
    console.log(JSON.stringify({ expired_preview_renewal: true }));
  }
  const proof = JSON.parse(
    readFileSync("/acceptance-state/test-proof.json", "utf8"),
  );
  const csrf = await fetch(api + "/api/v1/auth/csrf"),
    initial = await csrf.json();
  let cookies = csrf.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const login = await fetch(api + "/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie: cookies,
      "x-csrf-token": initial.csrfToken,
    },
    body: JSON.stringify({
      email: "google-acceptance@local.invalid",
      password: process.env.ACCEPTANCE_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error("acceptance_login_failed");
  const workspaceId = (await login.json()).workspace?.id;
  if (!workspaceId) throw new Error("workspace_missing");
  cookies = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const csrfToken = cookies
    .split("; ")
    .find((value) => value.startsWith("hm_v2_csrf="))
    ?.slice("hm_v2_csrf=".length);
  const request = async (path, method = "GET", body) => {
    const response = await fetch(api + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        origin,
        cookie: cookies,
        "x-csrf-token": csrfToken,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) {
      console.log(
        JSON.stringify({
          stage,
          http_status: response.status,
          code: safe(value?.error?.code ?? value?.code),
        }),
      );
      throw new Error("acceptance_api_request_failed");
    }
    return value;
  };
  const connection = await db.client.providerConnection.findFirst({
    where: { workspaceId, provider: "GOOGLE_ADS" },
  });
  if (!connection) throw new Error("connection_missing");
  stage = "filtered_discovery";
  await request(
    `/api/v1/workspaces/${workspaceId}/connections/${connection.id}/accounts/discover`,
    "POST",
  );
  const accounts = await db.client.providerAccount.findMany({
    where: { workspaceId, provider: "GOOGLE_ADS" },
  });
  if (
    accounts.some(
      (account) =>
        !["4378327049", "8590146099"].includes(account.externalAccountId),
    )
  )
    throw new Error("foreign_account_persisted_stop");
  const account = accounts.find(
    (account) => account.externalAccountId === "8590146099",
  );
  if (!account) throw new Error("test_client_account_not_discovered");
  stage = "select_test_client";
  await request(
    `/api/v1/workspaces/${workspaceId}/connections/${connection.id}/accounts`,
    "PATCH",
    { accountIds: [account.id] },
  );
  if (
    await db.client.providerAccount.count({
      where: {
        workspaceId,
        enabled: true,
        externalAccountId: { not: "8590146099" },
      },
    })
  )
    throw new Error("non_test_account_selected_stop");
  stage = "controlled_service_key";
  const key = existing?.service_token
    ? { token: existing.service_token }
    : await request(
        `/api/v1/workspaces/${workspaceId}/service-tokens`,
        "POST",
        {
          name: "Google TEST fixture preview only",
          scopes: ["adforge:mcp:read", "adforge:mcp:write"],
          resourceAccessMode: "STATIC_ALLOWLIST",
          accountIds: [account.id],
          expiresInDays: 1,
        },
      );
  if (typeof key.token !== "string") throw new Error("service_key_missing");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  fixtureName =
    existing?.brief?.campaign_name ?? `HM_MCP_WRITE_ACCEPTANCE_${stamp}`;
  const currency = proof.currency,
    amount = currency === "KZT" ? "1000" : "2",
    bid = currency === "KZT" ? "50" : "0.10";
  const texts = [
    "test marketing",
    "test advertising",
    "test search",
    "holy media test",
    "mcp test ads",
    "test marketing tools",
    "test advertising tools",
    "test search tools",
    "holy media test ads",
    "mcp test marketing",
    "test marketing demo",
    "test advertising demo",
    "test search demo",
    "holy media test demo",
    "mcp test demo",
    "test marketing sample",
    "test advertising sample",
    "test search sample",
    "holy media test sample",
    "mcp test sample",
  ];
  const brief = {
    provider: "GOOGLE_ADS",
    account_id: "8590146099",
    campaign_name: fixtureName,
    daily_budget: { amount, currency },
    bidding_strategy: "MANUAL_CPC",
    locations: [{ name: "Алматы", country_code: "KZ" }],
    languages: ["Russian"],
    ad_groups: [
      {
        name: "Acceptance Group",
        default_bid: { amount: bid, currency },
        keywords: texts.map((text, index) => ({
          text,
          match_type: index % 2 ? "PHRASE" : "EXACT",
        })),
        rsa: [
          {
            final_url: "https://mcp.holymedia.kz/",
            headlines: [
              { text: "Test Search Campaign" },
              { text: "HolyMedia MCP Test" },
              { text: "Sample Advertising Tools" },
            ],
            descriptions: [
              {
                text: "A paused campaign for testing advertising tools and approval.",
              },
              {
                text: "Generic sample content for a controlled test environment.",
              },
            ],
          },
        ],
      },
    ],
  };
  stage = "resolve_city";
  const credential = await db.client.providerCredential.findUnique({
    where: { connectionId: connection.id },
  });
  const credentials = new CredentialVaultService().decrypt(
    credential.encryptedPayload,
    credential.encryptionVersion,
  );
  const adapter = new GoogleAdsAdapter();
  const suggested = await providerJson(
    "https://googleads.googleapis.com/v24/geoTargetConstants:suggest",
    {
      method: "POST",
      headers: {
        ...adapter.headers(credentials.accessToken, "4378327049"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        locale: "ru",
        countryCode: "KZ",
        locationNames: { names: ["Алматы"] },
      }),
    },
    30000,
  );
  const city = (suggested.geoTargetConstantSuggestions ?? [])
    .map((entry) => entry.geoTargetConstant)
    .find((entry) => String(entry?.id) === "9235214");
  if (
    !city ||
    city.countryCode !== "KZ" ||
    city.status !== "ENABLED" ||
    city.targetType !== "City" ||
    city.canonicalName !== "Almaty,Kazakhstan"
  ) {
    console.log(
      JSON.stringify({
        stage,
        geo_candidates: (suggested.geoTargetConstantSuggestions ?? []).map(
          (entry) => ({
            id: entry.geoTargetConstant?.id,
            name: entry.geoTargetConstant?.canonicalName,
            type: entry.geoTargetConstant?.targetType,
          }),
        ),
      }),
    );
    throw new Error("almaty_city_reference_not_confirmed");
  }
  brief.locations[0].geo_target_id = String(city.id);
  console.log(
    JSON.stringify({
      selected_geo: {
        id: String(city.id),
        name: city.canonicalName,
        type: city.targetType,
      },
      daily_budget: brief.daily_budget,
      bidding_strategy: brief.bidding_strategy,
    }),
  );
  stage = "stage0_preview";
  const response = await fetch(api + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key.token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create_campaign_from_brief", arguments: brief },
    }),
  });
  const rpc = await response.json();
  const preview =
    rpc.result?.structuredContent ??
    (rpc.result?.content?.[0]?.text
      ? JSON.parse(rpc.result.content[0].text)
      : null);
  writeFileSync(
    "/acceptance-state/fixture-context.json",
    JSON.stringify({ brief, service_token: key.token, preview }),
    { mode: 0o600 },
  );
  if (
    !preview ||
    preview.status !== "preview" ||
    preview.provider_validation !== "passed" ||
    preview.partial_failure !== false ||
    !preview.approval_url
  ) {
    const error = rpc.error ?? preview?.error ?? preview;
    console.log(
      JSON.stringify({
        result: "BLOCKED",
        stage,
        fixture_campaign: fixtureName,
        rpc_error_code: error?.code ?? null,
        message:
          typeof error?.message === "string"
            ? error.message.slice(0, 800)
            : null,
        preview_status: preview?.status ?? null,
        google_validation: preview?.provider_validation ?? null,
        validation_errors: preview?.items
          ?.flatMap((item) => item.google_validation ?? [])
          .filter((result) => !result.success)
          .slice(0, 2),
        google_errors: preview?.google_errors,
        provider_writes: 0,
      }),
    );
    process.exitCode = 1;
  } else {
    stage = "campaign_nonexistence_reread";
    const saved = await db.client.providerCredential.findUnique({
      where: { connectionId: connection.id },
    });
    const credentials = new CredentialVaultService().decrypt(
      saved.encryptedPayload,
      saved.encryptionVersion,
    );
    const rows = await new GoogleAdsAdapter().searchStream(
      credentials.accessToken,
      "8590146099",
      "4378327049",
      `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.name = '${fixtureName}'`,
    );
    if (rows.length) throw new Error("campaign_exists_before_commit_stop");
    console.log(
      JSON.stringify({
        result: "READY_FOR_APPROVAL",
        fixture_campaign: fixtureName,
        preview_id: preview.preview_id,
        operation_count: preview.operation_count,
        provider_validation: preview.provider_validation,
        partial_failure: preview.partial_failure,
        campaign_plan: preview.campaign_plan,
        approval_url: preview.approval_url,
        expires_at: preview.expires_at,
        campaign_exists_before_commit: false,
        provider_writes: 0,
      }),
    );
  }
  const counts = readFileSync("/acceptance-state/provider-counts.jsonl", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  console.log(
    JSON.stringify({
      provider_read_calls_total: counts.filter((row) => row.type === "read")
        .length,
      validate_only_calls: counts.filter((row) => row.type === "validate_only")
        .length,
      real_provider_write_calls: 0,
      unapproved_accounts_queried: counts.filter(
        (row) =>
          row.type === "read" &&
          row.customer &&
          !["4378327049", "8590146099"].includes(row.customer),
      ).length,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      result: "BLOCKED",
      stage,
      fixture_campaign: fixtureName ?? null,
      error_class: safe(error.constructor.name),
      code: safe(error.message) ?? safe(error.code) ?? "internal_error",
      provider_writes: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDatabase(db);
}
