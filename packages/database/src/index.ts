import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { Pool } from "pg";

export { PrismaClient } from "./generated/prisma/client.js";
export { Prisma } from "./generated/prisma/client.js";

export type DatabaseHandle = {
  client: PrismaClient;
  pool: Pool;
};

export function createDatabase(url: string): DatabaseHandle {
  const pool = new Pool({ connectionString: url, max: 10 });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });
  return { client, pool };
}

export async function checkDatabase(database: DatabaseHandle): Promise<number> {
  const started = performance.now();
  await database.client.$queryRaw`SELECT 1`;
  return Math.round(performance.now() - started);
}

export async function closeDatabase(database: DatabaseHandle): Promise<void> {
  await database.client.$disconnect();
  await database.pool.end();
}
