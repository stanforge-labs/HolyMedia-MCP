export const DASHBOARD_ROUTES = {
  overview: "/dashboard",
  connections: "/dashboard/connections",
  mcp: "/dashboard/ai-client",
  reports: "/dashboard/reports",
  tariffs: "/dashboard/tariffs",
  profile: "/dashboard/profile",
  analysis: "/dashboard/analysis",
} as const;

export type DashboardSection = keyof typeof DASHBOARD_ROUTES;

const SECTION_BY_SLUG: Record<string, DashboardSection> = {
  overview: "overview",
  connections: "connections",
  "ai-client": "mcp",
  reports: "reports",
  tariffs: "tariffs",
  profile: "profile",
  analysis: "analysis",
};

export function dashboardSectionFromPath(pathname: string): DashboardSection {
  const slug = withoutLocale(pathname).split("/").filter(Boolean)[1];
  return (slug && SECTION_BY_SLUG[slug]) || "overview";
}

export function dashboardRoute(section: DashboardSection): string {
  return currentLocaleHref(DASHBOARD_ROUTES[section]);
}

export function dashboardSectionFromLegacyQuery(
  value: string | null,
): DashboardSection | null {
  if (!value) return null;
  return value === "ai-client" ? "mcp" : (SECTION_BY_SLUG[value] ?? null);
}
import { currentLocaleHref, withoutLocale } from "./locale-routing";
