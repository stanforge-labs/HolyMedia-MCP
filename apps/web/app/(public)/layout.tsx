import type { Metadata } from "next";
import type { ReactNode } from "react";

const publicBaseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export const metadata: Metadata = {
  metadataBase: new URL(publicBaseUrl),
  title: { default: "HolyPilot", template: "%s | HolyPilot" },
  description:
    "HolyPilot — ваш персональный AI-маркетолог для аналитики и отчётов.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "HolyPilot",
    title: "HolyPilot — ваш персональный AI-маркетолог",
    description:
      "Подключайте Meta Ads, Google Ads, TikTok Ads и Яндекс Директ к AI для аналитики и отчётов.",
    url: "/",
    locale: "ru_RU",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "HolyPilot",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HolyPilot — ваш персональный AI-маркетолог",
    description: "Рекламная аналитика и отчёты в AI-чате.",
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
