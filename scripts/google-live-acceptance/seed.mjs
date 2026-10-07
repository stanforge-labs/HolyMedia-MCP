import { createRequire } from "node:module";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { PasswordService } =
  await import("/workspace/apps/api/dist/auth/password.service.js");
const db = createDatabase(process.env.DATABASE_URL);
try {
  if (await db.client.user.count())
    throw new Error("acceptance_database_not_empty");
  const passwordHash = await new PasswordService().hash(
    process.env.ACCEPTANCE_PASSWORD,
  );
  const user = await db.client.user.create({
    data: {
      email: "google-acceptance@local.invalid",
      name: "Google TEST acceptance",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
  const workspace = await db.client.workspace.create({
    data: {
      name: "Google TEST acceptance",
      slug: "google-test-acceptance",
      accessStatus: "ACTIVE",
    },
  });
  await db.client.workspaceMembership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });
  console.log("DISPOSABLE_IDENTITY_READY");
} finally {
  await closeDatabase(db);
}
