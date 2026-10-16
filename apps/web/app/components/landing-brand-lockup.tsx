"use client";

import { useLanguage } from "./language-switcher";
import styles from "./landing-brand-lockup.module.css";

/** Public-home identity only; the shared application BrandLockup stays unchanged. */
export function LandingBrandLockup({ footer = false }: { footer?: boolean }) {
  const language = useLanguage();

  return (
    <span
      className={`${styles.brand}${footer ? ` ${styles.footerBrand}` : ""}`}
      data-language-static
    >
      <img
        className={styles.symbol}
        src="/assets/brand/holy-pilot-symbol.svg"
        alt=""
        width="736"
        height="751"
      />
      <span className={styles.copy}>
        <span className={styles.name}>HolyPilot</span>
        <span className={styles.tagline}>
          {language === "ru"
            ? "Ваш персональный AI-маркетолог"
            : "Your personal AI marketer"}
        </span>
      </span>
    </span>
  );
}
