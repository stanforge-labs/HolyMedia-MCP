// Generate deterministic first-party HolyPilot TEST advertising media.
// Usage: node scripts/pmax-firstparty-media.mjs <absolute-output-directory>
// Output is deliberately outside Git. No remote assets or advertising API calls.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const sharp = require("sharp");
const { validateInlineMedia } =
  await import("../apps/api/dist/providers/google-ads-media.js");
const output = process.argv[2];
if (!output || !isAbsolute(output))
  throw new Error("Pass an absolute output directory outside the repository.");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const insideRepo = (candidate) => {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
};
if (insideRepo(resolve(output)))
  throw new Error("Media output must remain outside the repository.");

const symbol = await readFile(
  new URL(
    "../apps/web/public/assets/brand/holy-pilot-symbol.svg",
    import.meta.url,
  ),
);
const symbolData = `data:image/svg+xml;base64,${symbol.toString("base64")}`;
const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const background = (width, height, color) =>
  `<rect width="${width}" height="${height}" fill="${color}"/>`;
const text = (x, y, value, size, color, weight = 700) =>
  `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(value)}</text>`;
const line = (x, y, width, color = "#cbd5e1") =>
  `<rect x="${x}" y="${y}" width="${width}" height="8" rx="4" fill="${color}"/>`;

function landscape() {
  const w = 1200;
  const h = 628;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${background(w, h, "#0b1220")}
    <circle cx="1050" cy="-30" r="340" fill="#172554" opacity=".8"/>
    <circle cx="1050" cy="-30" r="260" fill="#1e3a8a" opacity=".45"/>
    <rect x="52" y="52" width="1096" height="524" rx="36" fill="#111d33" stroke="#32445f" stroke-width="2"/>
    <rect x="88" y="94" width="80" height="80" rx="20" fill="#ffffff"/>
    <image href="${symbolData}" x="96" y="102" width="64" height="64"/>
    ${text(190, 146, "HolyPilot", 44, "#f8fafc")}
    ${text(88, 265, "Рекламные кабинеты", 49, "#f8fafc")}
    ${text(88, 328, "в AI-чате", 49, "#a5b4fc")}
    ${text(88, 404, "Ваш персональный AI-маркетолог", 24, "#cbd5e1", 500)}
    <rect x="88" y="465" width="290" height="60" rx="18" fill="#6366f1"/>
    ${text(119, 504, "Контроль изменений", 22, "#ffffff")}
    <rect x="710" y="174" width="364" height="300" rx="24" fill="#f8fafc"/>
    <rect x="738" y="208" width="170" height="16" rx="8" fill="#475569"/>
    ${line(738, 255, 300)}${line(738, 288, 245)}${line(738, 321, 278)}
    <rect x="738" y="368" width="300" height="67" rx="16" fill="#e0e7ff"/>
    <circle cx="773" cy="401" r="12" fill="#6366f1"/>
    ${text(798, 408, "Только после подтверждения", 18, "#312e81")}
  </svg>`);
}

function square() {
  const size = 1200;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${background(size, size, "#eef2ff")}
    <circle cx="1070" cy="145" r="310" fill="#dbeafe"/>
    <circle cx="110" cy="1100" r="310" fill="#c7d2fe"/>
    <rect x="74" y="74" width="1052" height="1052" rx="68" fill="#101a2f"/>
    <rect x="145" y="142" width="210" height="210" rx="48" fill="#ffffff"/>
    <image href="${symbolData}" x="163" y="160" width="174" height="174"/>
    ${text(145, 442, "HolyPilot", 86, "#ffffff")}
    ${text(145, 544, "Анализ рекламы", 67, "#a5b4fc")}
    ${text(145, 618, "в вашем AI-чате", 54, "#e2e8f0", 500)}
    <rect x="145" y="707" width="910" height="287" rx="34" fill="#1e2b45" stroke="#405477" stroke-width="2"/>
    <circle cx="222" cy="785" r="24" fill="#818cf8"/>
    ${text(270, 799, "1. Запрос", 38, "#ffffff")}
    <circle cx="222" cy="852" r="24" fill="#818cf8"/>
    ${text(270, 866, "2. Предпросмотр", 38, "#ffffff")}
    <circle cx="222" cy="919" r="24" fill="#818cf8"/>
    ${text(270, 933, "3. Подтверждение", 38, "#ffffff")}
  </svg>`);
}

await mkdir(output, { recursive: true });
if (insideRepo(await realpath(output)))
  throw new Error("Resolved media output must remain outside the repository.");
const files = [
  {
    name: "holypilot-landscape.jpg",
    kind: "landscape_marketing_image",
    bytes: await sharp(landscape())
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer(),
    mime_type: "image/jpeg",
  },
  {
    name: "holypilot-square.png",
    kind: "square_marketing_image",
    bytes: await sharp(square()).png({ palette: true, quality: 86 }).toBuffer(),
    mime_type: "image/png",
  },
  {
    name: "holypilot-logo.png",
    kind: "square_logo",
    bytes: await sharp(symbol)
      .resize(880, 880, { fit: "contain" })
      .extend({
        top: 160,
        bottom: 160,
        left: 160,
        right: 160,
        background: "#00000000",
      })
      .png({ palette: true })
      .toBuffer(),
    mime_type: "image/png",
  },
];
const manifest = {
  source: "apps/web/public/assets/brand/holy-pilot-symbol.svg",
  source_sha256: createHash("sha256").update(symbol).digest("hex"),
  account: "8590146099",
  purpose: "closed_TEST_PMax_acceptance",
  files: [],
};
let aggregateBytes = 0;
for (const item of files) {
  const metadata = await sharp(item.bytes, { failOn: "warning" }).metadata();
  const normalized = await sharp(item.bytes).rotate().toBuffer();
  if (
    !normalized.length ||
    metadata.width !== 1200 ||
    metadata.height !==
      (item.kind === "landscape_marketing_image" ? 628 : 1200) ||
    metadata.format !== (item.mime_type === "image/jpeg" ? "jpeg" : "png") ||
    item.bytes.length > 1024 * 1024
  )
    throw new Error(`Media validation failed for ${item.kind}`);
  const accepted = await validateInlineMedia({
    mime_type: item.mime_type,
    data_base64: item.bytes.toString("base64"),
  });
  if (accepted.width !== metadata.width || accepted.height !== metadata.height)
    throw new Error(
      `HolyMedia media validator changed dimensions for ${item.kind}`,
    );
  aggregateBytes += item.bytes.length;
  manifest.files.push({
    name: item.name,
    kind: item.kind,
    mime_type: item.mime_type,
    width: metadata.width,
    height: metadata.height,
    bytes: item.bytes.length,
    sha256: createHash("sha256").update(item.bytes).digest("hex"),
  });
}
if (aggregateBytes > 2 * 1024 * 1024)
  throw new Error("Aggregate media size exceeded 2 MiB");
for (const item of files)
  await writeFile(resolve(output, item.name), item.bytes, { flag: "wx" });
await writeFile(
  resolve(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    output,
    total_bytes: aggregateBytes,
    files: manifest.files,
  }),
);
