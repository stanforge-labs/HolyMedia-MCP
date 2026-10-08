import {test} from "node:test";import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";import {fileURLToPath,pathToFileURL} from "node:url";
test("runner paths decode Unicode and NODE_OPTIONS import URL safely",()=>{
 const path=fileURLToPath(new URL("run-db-integration.mjs",import.meta.url));
 assert.equal(existsSync(path),true);assert.equal(fileURLToPath(pathToFileURL(path)),path);
 const source=readFileSync(path,"utf8");assert.ok(source.includes("fileURLToPath(import.meta.url)"));assert.ok(source.includes("pathToFileURL(path.join(base"));
});
