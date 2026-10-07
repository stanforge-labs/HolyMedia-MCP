// Loopback-only SSH entry. OAuth is started via the real authenticated API route.
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
const api = "http://127.0.0.1:4000",
  origin = "http://localhost:4400";
let starting = false;
async function localLogin() {
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
  const setCookies = login.headers.getSetCookie();
  cookies = setCookies.map((x) => x.split(";")[0]).join("; ");
  const token = cookies
    .split("; ")
    .find((x) => x.startsWith("hm_v2_csrf="))
    ?.slice("hm_v2_csrf=".length);
  return { workspaceId, cookies, token, setCookies };
}
async function start() {
  const { workspaceId, cookies, token } = await localLogin();
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
  const assets = {
    "/mcp/approve": ["approval.html", "text/html; charset=utf-8"],
    "/acceptance/approval.mjs": [
      "approval.mjs",
      "text/javascript; charset=utf-8",
    ],
    "/acceptance/approval.css": ["approval.css", "text/css; charset=utf-8"],
  };
  if (req.method === "GET" && assets[url.pathname]) {
    const [file, type] = assets[url.pathname];
    res.setHeader("Content-Type", type);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.end(readFileSync(new URL(file, import.meta.url)));
    return;
  }
  if (req.method === "POST" && url.pathname === "/acceptance/session") {
    if (req.headers.origin !== origin || req.headers.authorization) {
      res.writeHead(403).end();
      return;
    }
    try {
      const session = await localLogin();
      res.setHeader("Set-Cookie", session.setCookies);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ csrfToken: session.token }));
    } catch {
      res.writeHead(503).end();
    }
    return;
  }
  if (
    req.method === "POST" &&
    [
      "/api/v1/mcp/public/approval/view",
      "/api/v1/mcp/public/approval",
    ].includes(url.pathname)
  ) {
    if (req.headers.origin !== origin || req.headers.authorization) {
      res.writeHead(403).end();
      return;
    }
    let length = 0;
    const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 4096) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const upstream = request(
      `${api}${url.pathname}`,
      {
        method: "POST",
        headers: {
          host: "localhost:4400",
          "content-type": "application/json",
          "content-length": body.length,
          origin,
          cookie: req.headers.cookie ?? "",
          "x-csrf-token": req.headers["x-csrf-token"] ?? "",
        },
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    upstream.setTimeout(15000, () => upstream.destroy());
    upstream.end(body);
    return;
  }
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
  // The unmodified API excludes provider callbacks from its api/v1 prefix.
  // Slice the original request target so the entire raw query is preserved.
  const upstreamPath =
    url.pathname === "/api/v1/oauth/GOOGLE_ADS/callback"
      ? "/oauth/GOOGLE_ADS/callback" +
        req.url.slice("/api/v1/oauth/GOOGLE_ADS/callback".length)
      : req.url;
  const upstream = request(
    `${api}${upstreamPath}`,
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
