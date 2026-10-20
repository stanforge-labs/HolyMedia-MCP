"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./language-switcher";

const MINIMUM_LOADER_DURATION = 1_050;

export function AppLoader() {
  const [visible, setVisible] = useState(true);
  const language = useLanguage();

  useEffect(() => {
    const startedAt = performance.now();
    const finish = () => {
      const remaining = Math.max(
        0,
        MINIMUM_LOADER_DURATION - (performance.now() - startedAt),
      );
      window.setTimeout(() => setVisible(false), remaining);
    };
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });
    return () => window.removeEventListener("load", finish);
  }, []);

  return (
    <div
      className={`app-loader${visible ? "" : " app-loader--hidden"}`}
      aria-hidden="true"
      data-loader-visible={visible ? "true" : "false"}
    >
      <div className="app-loader__mark" aria-hidden="true">
        <img src="/assets/brand/holy-pilot-symbol.svg" alt="" />
      </div>
      <div className="app-loader__identity">
        <span className="app-loader__name">HolyPilot</span>
        <span className="app-loader__tagline">
          {language === "ru"
            ? "Ваш персональный AI-маркетолог"
            : "Your personal AI marketer"}
        </span>
      </div>
      <span className="app-loader__progress" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}

export { MINIMUM_LOADER_DURATION };
