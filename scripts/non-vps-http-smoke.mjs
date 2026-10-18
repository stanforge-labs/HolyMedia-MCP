// Run against an isolated local/CI API with dummy credentials only.
import { randomUUID } from "node:crypto";
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

// Exercise the real API transaction, session cookie and duplicate boundary in
// disposable PostgreSQL/Redis. The browser-side Google tag remains OFF.
const csrfResponse = await check("/api/v1/auth/csrf", {}, 200);
const { csrfToken } = await csrfResponse.json();
const csrfCookie = csrfResponse.headers
  .getSetCookie()
  .map((value) => value.split(";", 1)[0])
  .find((value) => value.startsWith("hm_v2_csrf="));
if (!csrfToken || !csrfCookie) throw new Error("Missing CSRF proof");
const signup = {
  name: "Offline Smoke",
  email: `offline-${randomUUID()}@example.invalid`,
  password: "OfflineSmokeOnly12!",
  confirmPassword: "OfflineSmokeOnly12!",
};
const signupHeaders = {
  "content-type": "application/json",
  "x-csrf-token": csrfToken,
  cookie: csrfCookie,
};
const signupResponse = await check(
  "/api/v1/auth/signup",
  {
    method: "POST",
    headers: signupHeaders,
    body: JSON.stringify(signup),
  },
  201,
);
const signedUp = await signupResponse.json();
const sessionCookies = signupResponse.headers
  .getSetCookie()
  .map((value) => value.split(";", 1)[0]);
if (
  typeof signedUp?.user?.id !== "string" ||
  typeof signedUp?.workspace?.id !== "string" ||
  !sessionCookies.some((value) => value.startsWith("hm_v2_session=")) ||
  "passwordHash" in signedUp.user ||
  "sessionToken" in signedUp
) {
  throw new Error("Signup transaction/session contract failed");
}
const session = await check(
  "/api/v1/auth/session",
  { headers: { cookie: sessionCookies.join("; ") } },
  200,
);
const activeSession = await session.json();
if (activeSession?.user?.id !== signedUp.user.id) {
  throw new Error("Created session is not bound to new user");
}
await check(
  "/api/v1/auth/signup",
  {
    method: "POST",
    headers: signupHeaders,
    body: JSON.stringify(signup),
  },
  409,
);
console.log(
  "non-VPS HTTP smoke PASS: ready, REST/OpenAPI auth, signup/session/duplicate, schema",
);
