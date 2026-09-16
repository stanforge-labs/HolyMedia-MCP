import type { MetadataRoute } from "next";
import { localizedHref } from "./components/locale-routing";

const baseUrl = (
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz"
).replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/privacy", "/terms"].flatMap((path) =>
    (["ru", "en"] as const).map((locale) => ({
      url: `${baseUrl}${localizedHref(path, locale)}`,
      alternates: {
        languages: {
          ru: `${baseUrl}${path}`,
          en: `${baseUrl}${localizedHref(path, "en")}`,
          "x-default": `${baseUrl}${path}`,
        },
      },
      changeFrequency: path === "/" ? ("weekly" as const) : ("yearly" as const),
      priority: path === "/" ? 1 : 0.3,
    })),
  );
}
