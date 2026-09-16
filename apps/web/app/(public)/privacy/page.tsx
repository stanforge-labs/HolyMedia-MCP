import { publicPageMetadata } from "../../components/page-metadata";
import { LegalContent } from "../../components/legal-content";
import { LegalHeader } from "../../components/legal-header";
import { SiteFooter } from "../../components/site-footer";

export function generateMetadata() {
  return publicPageMetadata("/privacy", {
    ru: "Политика конфиденциальности HolyMedia MCP",
    en: "HolyMedia MCP Privacy Policy",
  });
}

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <LegalHeader />
      <LegalContent kind="privacy" />
      <SiteFooter />
    </main>
  );
}
