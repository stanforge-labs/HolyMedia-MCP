// Run against an isolated local/CI API with dummy credentials only.
const base = (
  process.env.NON_VPS_API_BASE_URL ?? "http://127.0.0.1:4000"
).replace(/\/$/, "");

async function check(path, init, expected) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    ...init,
  });
  if (response.status !== expected) {
    throw new Error(
      `${path}: expected HTTP ${expected}, got ${response.status}`,
    );
  }
  return response;
}

await check("/ready", {}, 200);
await check("/api/v1/auth/session", {}, 401);
await check("/api/v1/mcp/openapi", {}, 401);
await check(
  "/api/v1/mcp/rest/preview_google_ads_change",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "GOOGLE_ADS", account_id: "8590146099" }),
  },
  403,
);
await check(
  "/api/v1/mcp/rest/preview_google_ads_change",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer invalid-local-test-token",
    },
    body: JSON.stringify({ provider: "GOOGLE_ADS", account_id: "8590146099" }),
  },
  401,
);
const openapiResponse = await check("/docs-json", {}, 200);
const document = await openapiResponse.json();
if (!String(document.openapi).startsWith("3.") || !document.paths) {
  throw new Error("Missing API OpenAPI document");
}
if (
  !Object.entries(document.paths).some(
    ([path, methods]) =>
      path.endsWith("/auth/signup") && methods && "post" in methods,
  )
) {
  throw new Error("Signup route absent from OpenAPI document");
}
console.log(
  "non-VPS HTTP smoke PASS: ready, session, REST/OpenAPI auth, schema",
);
