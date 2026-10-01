import { trace } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(
  service: string,
  level: string = "info",
  destination?: pino.DestinationStream,
): Logger {
  const options = {
    level,
    base: { service },
    redact: {
      paths: [
        // Do not log complete request bodies or headers: approval nonces,
        // preview tokens, cookies and CSRF proofs may appear in either.
        "req.body",
        "request.body",
        "body",
        "req",
        "request",
        "req.headers",
        "request.headers",
        "headers",
        "authorization",
        "cookie",
        "csrfToken",
        "csrf_token",
        "approval_nonce",
        "approvalNonce",
        "approvalToken",
        "nonce",
        "approval",
        "preview_token",
        "previewToken",
        "req.headers.authorization",
        "headers.authorization",
        "accessToken",
        "refreshToken",
        "clientSecret",
        "password",
        "token",
      ],
      censor: "[REDACTED]",
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export function requestId(value?: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 128 ? normalized : randomUUID();
}

export function tracer(service: string) {
  return trace.getTracer(service);
}
