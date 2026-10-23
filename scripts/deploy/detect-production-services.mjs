import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const oidcMigration =
  "packages/database/prisma/migrations/0034_openai_oidc_identity/migration.sql";

export function detectProductionServices(paths) {
  // Release 0034 must use the explicit, operator-gated API -> Web workflow.
  // This is deliberately exact: other Prisma changes keep the normal policy.
  if (paths.includes(oidcMigration)) {
    return { openaiRelease: true, services: [] };
  }
  const matches = (pattern) => paths.some((path) => pattern.test(path));
  const common =
    /^(infra\/Dockerfile\.v2|package\.json|turbo\.json|tsconfig\.base\.json)$/;
  const services = [];
  if (matches(/^(apps\/web\/|packages\/contracts\/)/) || matches(common))
    services.push("web");
  if (
    matches(
      /^(apps\/api\/|packages\/(config|contracts|database|observability|site-audit)\/|infra\/api-runtime\.pnpm-workspace\.yaml$)/,
    ) ||
    matches(common)
  )
    services.push("api");
  if (
    matches(
      /^(apps\/worker\/|packages\/(config|contracts|database|observability|site-audit)\/|infra\/worker-runtime\.pnpm-workspace\.yaml$)/,
    ) ||
    matches(common)
  )
    services.push("worker");
  if (
    services.length === 0 &&
    matches(/^(pnpm-lock\.yaml|pnpm-workspace\.yaml)$/)
  )
    services.push("web", "api", "worker");
  return { openaiRelease: false, services };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const paths = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
  const result = detectProductionServices(paths);
  process.stdout.write(`openai_release=${result.openaiRelease}\n`);
  process.stdout.write(`services=${JSON.stringify(result.services)}\n`);
}
