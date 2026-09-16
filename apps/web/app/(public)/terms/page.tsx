import { publicPageMetadata } from "../../components/page-metadata";
import { LegalContent } from "../../components/legal-content";
import { LegalHeader } from "../../components/legal-header";
import { SiteFooter } from "../../components/site-footer";

export function generateMetadata() {
  return publicPageMetadata("/terms", {
    ru: "Условия использования HolyMedia MCP",
    en: "HolyMedia MCP Terms of Use",
  });
}

export default function TermsPage() {
  return (
    <main className="legal-page">
      <LegalHeader />
      <LegalContent kind="terms" />
      <SiteFooter />
    </main>
  );
}
