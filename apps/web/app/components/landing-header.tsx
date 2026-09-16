"use client";

import Link from "./locale-link";
import { useEffect, useState } from "react";
import { BrandLockup } from "./brand-lockup";
import { LanguageSwitcher } from "./language-switcher";

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const syncScrollState = () => setScrolled(window.scrollY > 4);
    syncScrollState();
    window.addEventListener("scroll", syncScrollState, { passive: true });
    return () => window.removeEventListener("scroll", syncScrollState);
  }, []);

  return (
    <header className={scrolled ? "site-header is-scrolled" : "site-header"}>
      <Link className="site-brand" href="/" aria-label="HolyMedia MCP">
        <BrandLockup />
      </Link>
      <nav className="site-nav" aria-label="Навигация">
        <a href="#steps">Как это работает</a>
        <a href="#tariffs">Тарифы</a>
        <LanguageSwitcher compact />
        <Link className="btn btn--secondary btn--small" href="/auth">
          Войти
        </Link>
        <Link className="btn btn--primary btn--small" href="/auth?mode=signup">
          Создать аккаунт
        </Link>
      </nav>
    </header>
  );
}
