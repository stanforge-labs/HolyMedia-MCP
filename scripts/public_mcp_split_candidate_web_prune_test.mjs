import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTestingPackage,
  isTestingLink,
} from "./public_mcp_split_candidate_web_prune.mjs";
test("remove optional testing peers, preserve Next runtime and its peer-key directory", () => {
  for (const name of [
    "playwright@1.55.1",
    "playwright-core@1.55.1",
    "@playwright+test@1.55.1",
  ])
    assert(isTestingPackage(name));
  for (const name of [
    "next@16.3.6_@playwright+test@1.55.1_react@19.2.8",
    "react@19.2.8",
    "react-dom@19.2.8",
    "sharp@0.35.4",
    "playwrightish@1.0.0",
  ])
    assert(!isTestingPackage(name));
});
test("preserve the Next symlink containing a peer-key substring", () => {
  assert(
    !isTestingLink(
      "../../../node_modules/.pnpm/next@16.3.6_@playwright+test@1.55.1_react@19.2.8/node_modules/next",
    ),
  );
  assert(
    !isTestingLink(
      "../../../node_modules/.pnpm/react@19.2.8/node_modules/react",
    ),
  );
  assert(
    isTestingLink("../@playwright+test@1.55.1/node_modules/@playwright/test"),
  );
  assert(isTestingLink("../playwright@1.55.1/node_modules/playwright"));
  assert(
    isTestingLink("../playwright-core@1.55.1/node_modules/playwright-core"),
  );
});
