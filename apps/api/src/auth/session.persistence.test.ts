import { afterEach, expect, it, vi } from "vitest";
import { SessionService } from "./session.service.js";
import { CookieService } from "./cookie.service.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("issues matching persistent cookies and absolute 14-day DB expiry", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SESSION_TTL_DAYS", "14");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
  const create = vi.fn().mockResolvedValue({ id: "session", userId: "user" });
  const service = new SessionService({
    client: { session: { create } },
  } as never);
  const result = await service.create("user", {
    headers: {},
    ip: "127.0.0.1",
  } as never);
  expect(create.mock.calls[0]![0].data.expiresAt.toISOString()).toBe(
    "2026-09-29T00:00:00.000Z",
  );
  expect(create.mock.calls[0]![0].data.tokenDigest).not.toBe(result.token);
  const setCookie = vi.fn();
  new CookieService().setSession({ setCookie } as never, result.token);
  expect(setCookie.mock.calls[0]![2]).toMatchObject({
    httpOnly: true,
    maxAge: 14 * 86400,
    sameSite: "lax",
    path: "/",
  });
});
it("next-day validation preserves absolute expiry; logout immediately rejects replay", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T00:00:00Z"));
  const row = {
    id: "session",
    userId: "user",
    expiresAt: new Date("2026-09-29"),
    revokedAt: null as Date | null,
    user: { status: "active" },
  };
  const update = vi.fn();
  const updateMany = vi.fn().mockImplementation(() => {
    row.revokedAt = new Date();
  });
  const service = new SessionService({
    client: { session: { findUnique: async () => row, update, updateMany } },
  } as never);
  expect(await service.validate("opaque-test-token")).toEqual({
    id: "session",
    userId: "user",
  });
  expect(update.mock.calls[0]![0].data).not.toHaveProperty("expiresAt");
  await service.revoke("session");
  expect(await service.validate("opaque-test-token")).toBeNull();
});
it.each(["expired", "revoked", "suspended"])(
  "rejects %s sessions",
  async (kind) => {
    vi.stubEnv("NODE_ENV", "test");
    const row = {
      id: "session",
      userId: "user",
      expiresAt: new Date(Date.now() + (kind === "expired" ? -1 : 86400000)),
      revokedAt: kind === "revoked" ? new Date() : null,
      user: { status: kind === "suspended" ? "suspended" : "active" },
    };
    const update = vi.fn();
    const service = new SessionService({
      client: { session: { findUnique: async () => row, update } },
    } as never);
    expect(await service.validate("opaque-test-token")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  },
);
