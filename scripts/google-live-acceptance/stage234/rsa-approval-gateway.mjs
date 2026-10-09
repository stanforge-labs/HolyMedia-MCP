// Disposable TEST-only approval UI. No automatic approval or provider API calls.
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import process from "node:process";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
const { fetch } = globalThis;
export const origin = "http://localhost:4403";
const api = "http://127.0.0.1:4000";
export function allowedRoute(method, pathname) {
  if (method === "GET")
    return [
      "/mcp/approve",
      "/acceptance/approval.mjs",
      "/acceptance/approval.css",
      "/health",
      "/ready",
    ].includes(pathname);
  return (
    method === "POST" &&
    [
      "/acceptance/session",
      "/api/v1/mcp/public/approval/view",
      "/api/v1/mcp/public/approval",
    ].includes(pathname)
  );
}
async function localLogin() {
  const csrf = await fetch(`${api}/api/v1/auth/csrf`, { redirect: "error" });
  if (!csrf.ok) throw Error("csrf_failed");
  let cookies = csrf.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const proof = (await csrf.json()).csrfToken;
  const login = await fetch(`${api}/api/v1/auth/login`, {
    method: "POST",
    redirect: "error",
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
  if (!login.ok) throw Error("login_failed");
  const setCookies = login.headers.getSetCookie();
  cookies = setCookies.map((x) => x.split(";")[0]).join("; ");
  const token = cookies
    .split("; ")
    .find((x) => x.startsWith("hm_v2_csrf="))
    ?.slice("hm_v2_csrf=".length);
  if (!token) throw Error("session_csrf_missing");
  return { token, setCookies };
}
export function startGateway() {
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["localhost:4403", "127.0.0.1:4403", "127.0.0.1:4001"].includes(
        req.headers.host,
      )
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, origin);
    if (url.search || !allowedRoute(req.method, url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    const assets = {
      "/mcp/approve": ["/acceptance/approval.html", "text/html; charset=utf-8"],
      "/acceptance/approval.mjs": [
        "/acceptance/approval.mjs",
        "text/javascript; charset=utf-8",
      ],
      "/acceptance/approval.css": [
        "/acceptance/approval.css",
        "text/css; charset=utf-8",
      ],
    };
    if (assets[url.pathname]) {
      const [file, mime] = assets[url.pathname];
      res.setHeader("Content-Type", mime);
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
      res.end(readFileSync(file));
      return;
    }
    if (
      req.method === "POST" &&
      (req.headers.origin !== origin || req.headers.authorization)
    ) {
      res.writeHead(403).end();
      return;
    }
    if (url.pathname === "/acceptance/session") {
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
    let body = Buffer.alloc(0);
    if (req.method === "POST") {
      for await (const chunk of req) {
        body = Buffer.concat([body, chunk]);
        if (body.length > 4096) {
          res.writeHead(413).end();
          return;
        }
      }
    }
    const upstream = request(
      `${api}${url.pathname}`,
      {
        method: req.method,
        headers: {
          host: "localhost:4403",
          origin,
          "content-type": "application/json",
          "content-length": body.length,
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
  }).listen(4001, "0.0.0.0");
}
if (process.env.STAGE234_APPROVAL_GATEWAY === "true") startGateway();
