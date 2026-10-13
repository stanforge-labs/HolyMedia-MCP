import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";

const request = { ip: "127.0.0.1", requestId: "test-request" } as never;

function setup(
  user: Record<string, unknown> | null,
  membership: Record<string, unknown> | null,
) {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HOLYMEDIA_PUBLIC_BASE_URL", "https://mcp-test.holymedia.kz");
  vi.stubEnv("CORS_ORIGINS", "https://mcp-test.holymedia.kz");
  vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "8590146099");
  vi.stubEnv("QRS_TEST_RESTRICTED_AUTH", "true");
  const database = {
    client: {
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        create: vi.fn(),
        update: vi.fn(),
      },
      workspace: { create: vi.fn() },
      workspaceMembership: {
        findFirst: vi.fn().mockResolvedValue(membership),
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
  const sessions = {
    create: vi.fn().mockResolvedValue({
      token: "test-session",
      session: { id: "session-id" },
    }),
  };
  const audit = { record: vi.fn() };
  const passwords = {
    verify: vi.fn().mockResolvedValue(true),
    needsRehash: vi.fn().mockReturnValue(false),
    hash: vi.fn(),
  };
  const service = new AuthService(
    database as never,
    passwords as never,
    sessions as never,
    {} as never,
    { consume: vi.fn() } as never,
    audit as never,
  );
  return { service, database, sessions, audit };
}

afterEach(() => vi.unstubAllEnvs());

describe("restricted TEST identity", () => {
  it("rejects unknown Google users without creating a user, workspace or session", async () => {
    const { service, database, sessions, audit } = setup(null, null);
    await expect(
      service.loginWithGoogle(
        { email: "outsider@example.test", name: "Outsider" },
        request,
      ),
    ).rejects.toThrow("TEST access is not granted");
    expect(database.client.$transaction).not.toHaveBeenCalled();
    expect(database.client.user.create).not.toHaveBeenCalled();
    expect(database.client.workspace.create).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "login_failure", success: false }),
    );
  });

  it("denies a known user without the exact active TEST owner membership", async () => {
    const { service, database, sessions } = setup(
      { id: "user-id", status: "active" },
      null,
    );
    await expect(
      service.loginWithGoogle(
        { email: "member@example.test", name: "Member" },
        request,
      ),
    ).rejects.toThrow("TEST access is not granted");
    expect(database.client.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "OWNER",
          workspace: expect.objectContaining({
            accessStatus: "ACTIVE",
            providerAccounts: {
              some: {
                provider: "GOOGLE_ADS",
                externalAccountId: "8590146099",
                enabled: true,
              },
            },
          }),
        }),
      }),
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("allows only the existing owner and issues a TEST session", async () => {
    const user = {
      id: "user-id",
      email: "owner@example.test",
      name: "Owner",
      status: "active",
      emailVerifiedAt: new Date(),
    };
    const workspace = {
      id: "workspace-id",
      name: "TEST",
      slug: "test",
      accessStatus: "ACTIVE",
      onboardingCompletedAt: new Date(),
    };
    const { service, database, sessions, audit } = setup(user, { workspace });
    const result = await service.loginWithGoogle(
      { email: user.email, name: user.name },
      request,
    );
    expect(result.workspace?.id).toBe("workspace-id");
    expect(sessions.create).toHaveBeenCalledOnce();
    expect(database.client.$transaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "login_success",
        metadata: { method: "google" },
      }),
    );
  });

  it("closes public signup in restricted TEST mode", async () => {
    const { service, database } = setup(null, null);
    await expect(
      service.signup(
        {
          email: "new@example.test",
          name: "New",
          password: "long-password",
          confirmPassword: "long-password",
        } as never,
        request,
      ),
    ).rejects.toThrow("Registration is closed in TEST");
    expect(database.client.user.create).not.toHaveBeenCalled();
  });
});
