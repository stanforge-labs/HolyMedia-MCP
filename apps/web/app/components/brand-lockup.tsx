"use client";

import { useLanguage } from "./language-switcher";

export function BrandLockup({ className = "" }: { className?: string }) {
  const language = useLanguage();

  return (
    <span className={`brand-lockup ${className}`.trim()}>
      <img
        className="brand-lockup__symbol"
        src="/assets/brand/holy-pilot-symbol.svg"
        alt=""
        width="38"
        height="39"
      />
      <span className="brand-lockup__copy">
        <span className="brand-lockup__name">HolyPilot</span>
        <span className="brand-lockup__tagline">
          {language === "ru"
            ? "Ваш персональный AI-маркетолог"
            : "Your personal AI marketer"}
        </span>
      </span>
    </span>
  );
}
