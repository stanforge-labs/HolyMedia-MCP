// Loopback-only SSH entry. OAuth is started via the real authenticated API route.
import { createServer, request } from "node:http";
const api = "http://127.0.0.1:4000",
  origin = "http://localhost:4400";
let starting = false;
async function start() {
  const csrf = await fetch(`${api}/api/v1/auth/csrf`);
  if (!csrf.ok) throw new Error("csrf_failed");
  let cookies = csrf.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const proof = (await csrf.json()).csrfToken;
  const login = await fetch(`${api}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie: cookies,
      "x-csrf-token": proof,
    },
    body: JSON.stringify({
      email: "google-acceptance@local.invalid",
      password: process.env.ACCEPTANCE_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error("login_failed");
  const workspaceId = (await login.json()).workspace?.id;
  if (typeof workspaceId !== "string" || !/^[A-Za-z0-9-]+$/.test(workspaceId))
    throw new Error("workspace_missing");
  cookies = login.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const token = cookies
    .split("; ")
    .find((x) => x.startsWith("hm_v2_csrf="))
    ?.slice("hm_v2_csrf=".length);
  const response = await fetch(
    `${api}/api/v1/workspaces/${workspaceId}/connections/GOOGLE_ADS/oauth/start`,
    {
      method: "POST",
      headers: { origin, cookie: cookies, "x-csrf-token": token },
    },
  );
  if (!response.ok) throw new Error("oauth_start_failed");
  const value = await response.json(),
    url = new URL(value.authorizationUrl);
  if (
    url.origin !== "https://accounts.google.com" ||
    url.searchParams.get("scope") !==
      "https://www.googleapis.com/auth/adwords" ||
    url.searchParams.get("access_type") !== "offline" ||
    url.searchParams.get("prompt") !== "consent" ||
    url.searchParams.get("redirect_uri") !==
      `${origin}/api/v1/oauth/GOOGLE_ADS/callback`
  )
    throw new Error("oauth_contract_mismatch");
  return url.toString();
}
createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    req.headers.host !== "localhost:4400" &&
    req.headers.host !== "127.0.0.1:4001" &&
    req.headers.host !== "127.0.0.1:4400"
  ) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url, origin);
  if (req.method === "GET" && url.pathname === "/acceptance/oauth/start") {
    if (starting) {
      res.writeHead(429).end("OAuth start pending");
      return;
    }
    starting = true;
    try {
      res.writeHead(302, { Location: await start() }).end();
    } catch {
      res
        .writeHead(503)
        .end("Acceptance OAuth start failed. No credentials displayed.");
    } finally {
      starting = false;
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/dashboard/connections") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      url.searchParams.get("oauth") === "success"
        ? "<!doctype html><title>HolyMedia TEST OAuth</title><h1>OAuth callback successful</h1><p>Credentials stored in disposable encrypted vault. Writes remain OFF. Return to Codex for test-account proof.</p>"
        : "<!doctype html><title>HolyMedia TEST OAuth</title><h1>OAuth callback failed</h1><p>Return to Codex. Do not copy authorization codes or tokens.</p>",
    );
    return;
  }
  if (
    req.method !== "GET" ||
    !["/health", "/ready", "/api/v1/oauth/GOOGLE_ADS/callback"].includes(
      url.pathname,
    )
  ) {
    res.writeHead(404).end();
    return;
  }
  const upstream = request(
    `${api}${req.url}`,
    { method: "GET", headers: { host: "localhost:4400" } },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  upstream.setTimeout(120000, () => upstream.destroy());
  upstream.end();
}).listen(4001, "0.0.0.0");
