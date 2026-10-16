import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const symbol = await readFile(
    join(
      process.cwd(),
      "public",
      "assets",
      "brand",
      "holy-pilot-symbol-og.png",
    ),
  );

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "76px",
        background: "#0b0d11",
        color: "#edf0f5",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          color: "#91aaff",
          fontSize: 28,
          fontWeight: 700,
        }}
      >
        <img
          src={`data:image/png;base64,${symbol.toString("base64")}`}
          width={48}
          height={48}
          alt=""
        />
        HolyPilot
      </div>
      <div
        style={{
          marginTop: 42,
          maxWidth: 900,
          fontSize: 70,
          fontWeight: 700,
          lineHeight: 1.08,
        }}
      >
        AI-доступ к рекламным кабинетам
      </div>
      <div style={{ marginTop: 24, color: "#a4adbb", fontSize: 30 }}>
        Рекламная аналитика и отчёты в вашем AI-чате
      </div>
    </div>,
    size,
  );
}
