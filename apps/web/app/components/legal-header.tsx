"use client";

import Link from "./locale-link";
import { useCallback, useEffect, useState } from "react";
import { BrandLockup } from "./brand-lockup";
import { LanguageSwitcher } from "./language-switcher";
import { currentLocaleHref } from "./locale-routing";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

/** Keeps the public legal pages from looking like a logout for signed-in users. */
export function LegalHeader() {
  const [destination, setDestination] = useState<"/" | "/dashboard" | null>(
    null,
  );

  const resolveDestination = useCallback(async (): Promise<
    "/" | "/dashboard"
  > => {
    try {
      const response = await fetch(`${API}/api/v1/workspaces`, {
        credentials: "include",
        cache: "no-store",
      });
      return response.ok ? "/dashboard" : "/";
    } catch {
      return "/";
    }
  }, []);

  useEffect(() => {
    let active = true;
    void resolveDestination().then((nextDestination) => {
      if (active) setDestination(nextDestination);
    });
    return () => {
      active = false;
    };
  }, [resolveDestination]);

  return (
    <header className="legal-header">
      <Link
        className="legal-brand"
        href={destination ?? "/"}
        aria-label="HolyMedia MCP"
        onClick={(event) => {
          if (destination) return;
          event.preventDefault();
          void resolveDestination().then((nextDestination) => {
            window.location.assign(currentLocaleHref(nextDestination));
          });
        }}
      >
        <BrandLockup />
      </Link>
      <div className="legal-language">
        <LanguageSwitcher compact />
      </div>
    </header>
  );
}
