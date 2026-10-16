import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";

const request = { ip: "127.0.0.1", requestId: "signup-mock" } as never;
const input = {
  email: "owner@example.test",
  name: "Owner",
  password: "a-long-local-test-password",
  confirmPassword: "a-long-local-test-password",
} as never;

function setup() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("QRS_TEST_RESTRICTED_AUTH", "false");
  const sequence: string[] = [];
  const user = {
    id: "user-1",
    email: "owner@example.test",
    name: "Owner",
    emailVerifiedAt: null,
  };
  const workspace = {
    id: "workspace-1",
    name: "Owner workspace",
    slug: "owner-local",
    accessStatus: "PENDING" as const,
  };
  const tx = {
    user: { create: vi.fn(async () => user) },
    workspace: { create: vi.fn(async () => workspace) },
    workspaceMembership: { create: vi.fn(async () => ({})) },
  };
  const database = {
    client: {
      user: { findUnique: vi.fn(async () => null) },
      emailVerification: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) => {
          const result = await callback(tx);
          sequence.push("committed");
          return result;
        },
      ),
    },
  };
  const emails = {
    sendVerification: vi.fn(async () => {
      sequence.push("verification_queued");
    }),
  };
  const sessions = {
    create: vi.fn(async () => {
      sequence.push("session_created");
      return { token: "mock-token", session: { id: "session-1" } };
    }),
  };
  const audit = {
    record: vi.fn(async () => {
      sequence.push("audit_recorded");
    }),
  };
  const service = new AuthService(
    database as never,
    { hash: vi.fn(async () => "mock-hash") } as never,
    sessions as never,
    emails as never,
    { consume: vi.fn(async () => undefined) } as never,
    audit as never,
  );
  return { service, database, emails, sessions, audit, sequence, tx };
}

afterEach(() => vi.unstubAllEnvs());

describe("first-party sign_up truth boundary (no Google event)", () => {
  it("records a completed registration only after the user, workspace, membership and session exist", async () => {
    const f = setup();
    const result = await f.service.signup(input, request);
    expect(result.user.id).toBe("user-1");
    expect(result.workspace?.id).toBe("workspace-1");
    expect(f.tx.workspaceMembership.create).toHaveBeenCalledOnce();
    expect(f.sequence).toEqual([
      "committed",
      "verification_queued",
      "session_created",
      "audit_recorded",
    ]);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "signup",
        actorUserId: "user-1",
        workspaceId: "workspace-1",
      }),
    );
  });

  it("never records a successful signup if post-transaction session creation fails", async () => {
    const f = setup();
    f.sessions.create.mockRejectedValueOnce(new Error("session unavailable"));
    await expect(f.service.signup(input, request)).rejects.toThrow(
      "session unavailable",
    );
    expect(f.sequence).toEqual(["committed", "verification_queued"]);
    expect(f.audit.record).not.toHaveBeenCalled();
  });
});
