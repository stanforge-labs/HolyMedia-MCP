import type { NextConfig } from "next";

const apiOrigin = new URL(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://mcp.holymedia.kz",
).origin;
const upgradeInsecureRequests = apiOrigin.startsWith("https:")
  ? "; upgrade-insecure-requests"
  : "";
const signupGoogleTagEnabled =
  process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_ENABLED === "true" &&
  process.env.NEXT_PUBLIC_TEST_RESTRICTED_AUTH !== "true" &&
  /^AW-[1-9][0-9]{5,19}$/.test(
    process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_CONVERSION_ID ?? "",
  ) &&
  /^[A-Za-z0-9_-]{3,100}$/.test(
    process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_LABEL ?? "",
  );
const googleTagScript = signupGoogleTagEnabled
  ? " https://www.googletagmanager.com"
  : "";
const googleTagNetwork = signupGoogleTagEnabled
  ? " https://www.google.com https://www.googleadservices.com https://googleads.g.doubleclick.net"
  : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: ${apiOrigin}${googleTagNetwork}; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${googleTagScript}; connect-src 'self' ${apiOrigin}${googleTagNetwork}${upgradeInsecureRequests}`,
          },
        ],
      },
      ...["/mcp/approve", "/en/mcp/approve"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      })),
    ];
  },
};

export default nextConfig;
