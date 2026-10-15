import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const script = new URL(
  "../infra/test-mcp/http-healthcheck.sh",
  import.meta.url,
);
const linux = process.platform === "linux";

async function server(handler) {
  const instance = createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  return instance;
}

async function probe(port, path) {
  const child = spawn("bash", [script.pathname, String(port), path], {
    stdio: "ignore",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

test(
  "TEST health probe accepts real HTTP 200 for ready and auth",
  { skip: !linux },
  async () => {
    const instance = await server((request, response) => {
      response.writeHead(
        request.url === "/ready" || request.url === "/auth" ? 200 : 404,
      );
      response.end("ok");
    });
    try {
      const { port } = instance.address();
      assert.equal(await probe(port, "/ready"), 0);
      assert.equal(await probe(port, "/auth"), 0);
    } finally {
      instance.close();
    }
  },
);

test(
  "TEST health probe fails closed on error, redirect and wrong path",
  { skip: !linux },
  async () => {
    const instance = await server((_request, response) => {
      response.writeHead(503);
      response.end("unavailable");
    });
    const refusedPort = instance.address().port;
    try {
      assert.notEqual(await probe(refusedPort, "/ready"), 0);
      assert.notEqual(await probe(refusedPort, "/wrong"), 0);
    } finally {
      await new Promise((resolve) => instance.close(resolve));
    }
    assert.notEqual(await probe(refusedPort, "/ready"), 0);

    const redirect = await server((_request, response) => {
      response.writeHead(302, { Location: "/auth" });
      response.end();
    });
    try {
      assert.notEqual(await probe(redirect.address().port, "/auth"), 0);
    } finally {
      redirect.close();
    }
  },
);

test(
  "TEST health probe times out on stalled response",
  { skip: !linux },
  async () => {
    const instance = await server(() => {});
    try {
      const started = Date.now();
      assert.notEqual(await probe(instance.address().port, "/ready"), 0);
      assert.ok(Date.now() - started < 5000);
    } finally {
      instance.closeAllConnections();
      instance.close();
    }
  },
);
