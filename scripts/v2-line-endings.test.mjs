import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const attributes = readFileSync(join(root, ".gitattributes"));
const prettier = join(root, "node_modules/prettier/bin/prettier.cjs");
const textFiles = {
  "package.json": '{\n  "name": "checkout-policy-fixture"\n}\n',
  "apps/web/app/page.tsx": "export const value = 1;\n",
  "packages/database/prisma/schema.prisma": "// schema fixture\n",
  "scripts/check.mjs": "export const value = 1;\n",
  "scripts/run.sh": "#!/bin/sh\necho ok\n",
  "infra/example.conf": "example\n",
  "config.env.example": "EXAMPLE=fixture\n",
  "example.service.example": "[Unit]\n",
  ".github/workflows/fixture.yml": "name: fixture\n",
  "docs/fixture.md": "# Fixture\n",
  "apps/web/public/icon.svg":
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
};
// Even non-NUL bytes with CRLF must survive known binary extensions unchanged.
const binaryBytes = Buffer.from("binary fixture\r\nwith preserved CRLF\r\n");
const binaryExtensions = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "webp",
  "woff",
  "woff2",
  "ttf",
  "pdf",
  "zip",
  "docx",
  "pptx",
  "xlsx",
  "mp4",
];

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

function checkFormatting(cwd) {
  return spawnSync(process.execPath, [prettier, "--check", "package.json"], {
    cwd,
    encoding: "utf8",
  });
}

for (const autocrlf of ["true", "false", "input"]) {
  test(`fresh checkout preserves LF and binary bytes with core.autocrlf=${autocrlf}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "holymedia-eol-policy-"));
    try {
      const seed = join(directory, "seed");
      const checkout = join(directory, "checkout");
      mkdirSync(seed);
      writeFileSync(join(seed, ".gitattributes"), attributes);
      for (const [file, content] of Object.entries(textFiles)) {
        mkdirSync(dirname(join(seed, file)), { recursive: true });
        writeFileSync(join(seed, file), content);
      }
      for (const extension of binaryExtensions)
        writeFileSync(join(seed, `fixture.${extension}`), binaryBytes);
      git(seed, "init", "--quiet");
      git(seed, "-c", "core.autocrlf=false", "add", ".");
      git(
        seed,
        "-c",
        "user.name=Checkout policy fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      );
      git(
        directory,
        "clone",
        "--quiet",
        "--no-local",
        "-c",
        `core.autocrlf=${autocrlf}`,
        seed,
        checkout,
      );
      for (const [file, content] of Object.entries(textFiles))
        assert.equal(readFileSync(join(checkout, file), "utf8"), content, file);
      for (const extension of binaryExtensions)
        assert.deepEqual(
          readFileSync(join(checkout, `fixture.${extension}`)),
          binaryBytes,
          extension,
        );
      const result = checkFormatting(checkout);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(git(checkout, "status", "--porcelain"), "");
    } finally {
      // Only remove the exact temporary directory created by this test.
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("format check rejects CRLF instead of masking a broken checkout policy", () => {
  const directory = mkdtempSync(join(tmpdir(), "holymedia-eol-negative-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      textFiles["package.json"].replaceAll("\n", "\r\n"),
    );
    const result = checkFormatting(directory);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Code style issues found/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
