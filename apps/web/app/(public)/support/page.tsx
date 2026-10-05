import { publicPageMetadata } from "../../components/page-metadata";
import { SupportContent } from "../../components/support-content";
import { LegalHeader } from "../../components/legal-header";
import { SiteFooter } from "../../components/site-footer";

export function generateMetadata() {
  return publicPageMetadata("/support", {
    ru: "Поддержка HolyMedia MCP",
    en: "HolyMedia MCP Support",
  });
}

export default function SupportPage() {
  return (
    <main className="legal-page">
      <LegalHeader />
      <SupportContent />
      <SiteFooter />
    </main>
  );
}
