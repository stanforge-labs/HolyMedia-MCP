import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Approve change | HolyMedia MCP",
  robots: { index: false, follow: false, noarchive: true },
};

export default function ApprovalLayout({ children }: { children: ReactNode }) {
  return children;
}
