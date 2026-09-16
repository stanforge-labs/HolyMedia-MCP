"use client";

import Link from "./locale-link";
import { useLanguage } from "./language-switcher";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  const copy =
    language === "ru"
      ? {
          legal: "Юридическая информация",
          privacy: "Политика конфиденциальности",
          terms: "Условия использования",
          astanaHub: "Astana Hub",
        }
      : {
          legal: "Legal information",
          privacy: "Privacy policy",
          terms: "Terms of use",
          astanaHub: "Astana Hub",
        };

  return (
    <footer
      className={compact ? "footer footer--app" : "footer footer--landing"}
      data-language-static
    >
      <div className="footer__left">
        <div className="footer__identity">
          <img
            className="footer__brand-logo footer__brand-logo--dark"
            src="/assets/brand/holymedia-mcp-horizontal-dark.svg"
            alt="HolyMedia MCP"
          />
          <img
            className="footer__brand-logo footer__brand-logo--light"
            src="/assets/brand/holymedia-mcp-horizontal.svg"
            alt="HolyMedia MCP"
          />
        </div>
        <a
          className="footer__partner"
          href="https://astanahub.com/"
          target="_blank"
          rel="noreferrer"
          aria-label={copy.astanaHub}
        >
          <img
            className="footer__partner-logo footer__partner-logo--dark-theme"
            src="/assets/astana-hub-dark.svg"
            alt="Astana Hub"
          />
          <img
            className="footer__partner-logo footer__partner-logo--light-theme"
            src="/assets/astana-hub-light.svg"
            alt=""
          />
        </a>
      </div>
      <nav className="footer__links" aria-label={copy.legal}>
        <Link href="/privacy">{copy.privacy}</Link>
        <Link href="/terms">{copy.terms}</Link>
      </nav>
    </footer>
  );
}
