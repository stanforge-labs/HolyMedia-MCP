import { createServer, request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_PORT = 4000;
const WEB_PORT = 3000;

export function upstreamFor(pathname) {
  if (pathname === "/api/health") return "web";
  if (pathname === "/mcp/approve" || pathname.startsWith("/mcp/approve/"))
    return "web";
  if (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/oauth" ||
    pathname.startsWith("/oauth/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/health" ||
    pathname === "/ready" ||
    pathname.startsWith("/auth/google/")
  )
    return "api";
  return "web";
}

export function safePathname(pathname) {
  if (
    ["/mcp", "/mcp/public", "/health", "/ready", "/api/health"].includes(
      pathname,
    )
  )
    return pathname;
  if (pathname.startsWith("/.well-known/")) return "/.well-known/*";
  if (pathname.startsWith("/oauth/")) return "/oauth/*";
  if (pathname.startsWith("/api/")) return "/api/*";
  if (pathname.startsWith("/mcp/")) return "/mcp/*";
  return "/web/*";
}

function withoutHopHeaders(headers) {
  const copy = { ...headers };
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])
    delete copy[name];
  return copy;
}

export function createGateway({
  apiPort = API_PORT,
  webPort = WEB_PORT,
  logger = console.log,
} = {}) {
  return createServer((incoming, outgoing) => {
    const started = performance.now();
    let url;
    try {
      if (!incoming.url?.startsWith("/")) throw new Error("invalid path");
      url = new URL(incoming.url, "http://gateway.invalid");
    } catch {
      outgoing.writeHead(400).end("Bad request");
      logger(
        JSON.stringify({
          method: incoming.method ?? "UNKNOWN",
          pathname: "/invalid",
          status: 400,
          duration_ms: Math.round(performance.now() - started),
        }),
      );
      return;
    }
    const route = upstreamFor(url.pathname);
    const targetPort = route === "api" ? apiPort : webPort;
    let logged = false;
    const log = (status) => {
      if (logged) return;
      logged = true;
      logger(
        JSON.stringify({
          method: incoming.method ?? "UNKNOWN",
          pathname: safePathname(url.pathname),
          status,
          duration_ms: Math.round(performance.now() - started),
        }),
      );
    };
    const headers = withoutHopHeaders(incoming.headers);
    // The browser, OAuth issuer and cookies must all retain the public origin.
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-host"] = incoming.headers.host ?? "";
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        method: incoming.method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (response) => {
        const status = response.statusCode ?? 502;
        outgoing.writeHead(status, withoutHopHeaders(response.headers));
        response.pipe(outgoing);
        response.on("end", () => log(status));
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent)
        outgoing.writeHead(502).end("Upstream unavailable");
      else outgoing.destroy();
      log(502);
    });
    incoming.on("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const server = createGateway();
  server.listen(8787, "127.0.0.1", () => {
    console.log(
      JSON.stringify({
        method: "START",
        pathname: "/gateway",
        status: 200,
        duration_ms: 0,
      }),
    );
  });
}
