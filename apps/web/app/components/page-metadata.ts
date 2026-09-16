import type { Metadata } from "next";
import { headers } from "next/headers";
import { localizedHref } from "./locale-routing";

export async function publicPageMetadata(
  path: string,
  titles: { ru: string; en: string },
): Promise<Metadata> {
  const locale =
    (await headers()).get("x-holymedia-page-locale") === "en" ? "en" : "ru";
  const canonical = localizedHref(path, locale);
  return {
    title: titles[locale],
    alternates: {
      canonical,
      languages: { ru: path, en: localizedHref(path, "en"), "x-default": path },
    },
    openGraph: {
      title: titles[locale],
      url: canonical,
      locale: locale === "en" ? "en_US" : "ru_RU",
    },
    robots: { index: true, follow: true },
  };
}
