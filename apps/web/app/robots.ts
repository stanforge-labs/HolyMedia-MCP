import type { MetadataRoute } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export default function robots(): MetadataRoute.Robots {
  const productionHost = new URL(baseUrl).hostname === "mcp.holymedia.kz";
  return {
    rules: productionHost
      ? [
          {
            userAgent: "*",
            allow: "/",
            disallow: [
              "/dashboard",
              "/app",
              "/admin",
              "/auth",
              "/onboarding",
              "/invitations",
              "/api",
              "/oauth",
              "/connect",
              "/en/dashboard",
              "/en/app",
              "/en/admin",
              "/en/auth",
              "/en/onboarding",
              "/en/invitations",
              "/en/connect",
            ],
          },
        ]
      : [{ userAgent: "*", disallow: "/" }],
    sitemap: productionHost ? `${baseUrl}/sitemap.xml` : undefined,
    host: productionHost ? baseUrl : undefined,
  };
}
