"use client";

import { useEffect, useState } from "react";
import { BrandLockup } from "./brand-lockup";

const MINIMUM_LOADER_DURATION = 1_050;

export function AppLoader() {
  const [visible, setVisible] = useState(true);

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
      <span className="app-loader__node app-loader__node--one" />
      <span className="app-loader__node app-loader__node--two" />
      <span className="app-loader__node app-loader__node--three" />
      <div className="app-loader__mark" aria-hidden="true">
        <BrandLockup className="brand-lockup--loader" />
      </div>
      <p className="app-loader__caption">Готовим рабочее пространство</p>
      <span className="app-loader__progress" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}

export { MINIMUM_LOADER_DURATION };
