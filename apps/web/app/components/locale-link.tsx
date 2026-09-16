"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { localizedHref, localeFromPath } from "./locale-routing";

export default function LocaleLink({
  href,
  ...props
}: ComponentProps<typeof Link>) {
  const locale = localeFromPath(usePathname());
  return (
    <Link
      {...props}
      href={
        typeof href === "string"
          ? (localizedHref(href, locale) as typeof href)
          : href
      }
    />
  );
}
