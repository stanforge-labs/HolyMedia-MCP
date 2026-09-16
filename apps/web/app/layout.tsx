import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppLoader } from "./components/app-loader";
import { ThemeProvider } from "./components/theme-provider";
import "./globals.css";

const publicBaseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export const metadata: Metadata = {
  metadataBase: new URL(publicBaseUrl),
  title: "HolyMedia MCP — AI-доступ к рекламным кабинетам",
  description:
    "Подключайте рекламные кабинеты к AI для аналитики и отчётов в HolyMedia MCP.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale =
    (await headers()).get("x-holymedia-page-locale") === "en" ? "en" : "ru";
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0b0d11"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#f4f6fa"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('holymedia-theme');var t=p==='light'?'light':'dark';if(p==='system')localStorage.setItem('holymedia-theme','dark');document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=t;document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark';}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AppLoader />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
