/** Owner-operated, one-shot maintenance. Never called by an HTTP route or MCP tool. */
import { readFileSync } from "node:fs";
import argon2 from "argon2";
import { closeDatabase, createDatabase, Prisma } from "@holymedia/database";

const slug = "holypilot-anthropic-reviewer-demo";
const approval = "OWNER_APPROVED_REVIEWER_DEMO";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const action = process.argv[2];
  if (!["inspect", "provision", "remove"].includes(action ?? ""))
    throw new Error("Expected inspect, provision or remove");
  if (
    action !== "inspect" &&
    required("REVIEWER_DEMO_OWNER_APPROVAL") !== approval
  )
    throw new Error("Explicit owner approval is required");
  const database = createDatabase(required("DATABASE_URL"));
  try {
    const client = database.client;
    const existing = await client.workspace.findUnique({
      where: { slug },
      include: {
        memberships: { include: { user: true } },
        entitlements: {
          select: { featureKey: true, value: true, source: true },
        },
      },
    });
    if (action === "inspect") {
      // Only the dedicated demo identity is printed, never credentials or client data.
      process.stdout.write(
        JSON.stringify({
          present: Boolean(existing),
          isolated: existing?.reviewerDemo === true,
          members: existing?.memberships.length ?? 0,
          reviewerUserId: existing?.reviewerDemo
            ? existing.memberships[0]?.userId
            : undefined,
        }) + "\n",
      );
      return;
    }
    const email = required("REVIEWER_DEMO_EMAIL").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Invalid reviewer email");
    if (
      existing &&
      (!existing.reviewerDemo ||
        existing.memberships.length !== 1 ||
        existing.memberships[0]?.user.email !== email ||
        existing.memberships[0].user.status !== "active" ||
        existing.memberships[0].role !== "VIEWER")
    )
      throw new Error(
        "Existing workspace conflicts with the isolated reviewer invariant",
      );

    if (action === "provision") {
      if (existing) {
        if (
          (await client.providerConnection.count({
            where: { workspaceId: existing.id },
          })) ||
          (await client.providerAccount.count({
            where: { workspaceId: existing.id },
          }))
        )
          throw new Error(
            "Reviewer workspace unexpectedly contains provider data",
          );
        if (
          ![
            ["mcp", true],
            ["reports", true],
            ["monthly_mcp_requests", 300],
          ].every(([featureKey, value]) =>
            existing.entitlements.some(
              (item) =>
                item.featureKey === featureKey &&
                item.value === value &&
                item.source === "reviewer_demo_bootstrap",
            ),
          )
        )
          throw new Error(
            "Existing reviewer entitlements are incomplete or altered",
          );
        process.stdout.write(
          "Isolated reviewer workspace already provisioned; no changes.\n",
        );
        return;
      }
      if (await client.user.findUnique({ where: { email } }))
        throw new Error("Reviewer email is already associated with a user");
      const password = readFileSync(
        required("REVIEWER_DEMO_PASSWORD_FILE"),
        "utf8",
      ).trimEnd();
      if (password.length < 20 || password.length > 256)
        throw new Error("Reviewer password length must be 20–256 characters");
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      await client.$transaction(
        async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              name: "Anthropic reviewer",
              passwordHash,
              emailVerifiedAt: new Date(),
            },
          });
          const workspace = await tx.workspace.create({
            data: {
              name: "HolyPilot reviewer demo · synthetic data",
              slug,
              reviewerDemo: true,
              accessStatus: "ACTIVE",
              onboardingCompletedAt: new Date(),
            },
          });
          await tx.workspaceMembership.create({
            data: {
              workspaceId: workspace.id,
              userId: user.id,
              role: "VIEWER",
            },
          });
          await tx.entitlement.createMany({
            data: [
              {
                workspaceId: workspace.id,
                featureKey: "mcp",
                value: true,
                source: "reviewer_demo_bootstrap",
              },
              {
                workspaceId: workspace.id,
                featureKey: "reports",
                value: true,
                source: "reviewer_demo_bootstrap",
              },
              {
                workspaceId: workspace.id,
                featureKey: "monthly_mcp_requests",
                value: 300,
                source: "reviewer_demo_bootstrap",
              },
            ],
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      process.stdout.write(
        "Isolated synthetic reviewer workspace provisioned.\n",
      );
      return;
    }

    if (!existing) {
      process.stdout.write("Isolated reviewer workspace absent; no changes.\n");
      return;
    }
    const member = existing.memberships[0]!;
    if (required("REVIEWER_DEMO_EXPECT_USER_ID") !== member.userId)
      throw new Error("Reviewer user confirmation does not match");
    await client.$transaction(
      async (tx) => {
        const [connections, accounts, memberships] = await Promise.all([
          tx.providerConnection.count({ where: { workspaceId: existing.id } }),
          tx.providerAccount.count({ where: { workspaceId: existing.id } }),
          tx.workspaceMembership.count({ where: { userId: member.userId } }),
        ]);
        if (connections || accounts || memberships !== 1)
          throw new Error("Reviewer cleanup blocked by non-demo relationships");
        // Workspace/user relations (including issued OAuth tokens) cascade according
        // to the existing Prisma schema; do not delete any unrelated identity.
        await tx.workspace.delete({
          where: { id: existing.id, reviewerDemo: true },
        });
        await tx.user.delete({ where: { id: member.userId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    process.stdout.write("Isolated reviewer workspace and user removed.\n");
  } finally {
    await closeDatabase(database);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Reviewer maintenance failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
