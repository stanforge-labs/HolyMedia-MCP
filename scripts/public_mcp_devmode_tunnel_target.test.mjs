import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTunnelTarget,
  TUNNEL_TARGET,
} from "./public_mcp_devmode_tunnel_target.mjs";

const tunnel = (addr, publicUrl = "https://disposable.ngrok.app") => ({
  public_url: publicUrl,
  config: { addr, inspect: false },
});

test("accepts the exact gateway target and one HTTPS origin", () => {
  assert.equal(TUNNEL_TARGET, "127.0.0.1:8787");
  assert.equal(
    assertTunnelTarget({
      tunnels: [
        tunnel("http://127.0.0.1:8787"),
        tunnel("127.0.0.1:8787", "http://disposable.ngrok.app"),
      ],
    }),
    "https://disposable.ngrok.app",
  );
});

test("rejects direct API/Web and alternate gateway targets", () => {
  for (const addr of [
    "127.0.0.1:4000",
    "0.0.0.0:4000",
    "127.0.0.1:3000",
    "localhost:8787",
    "0.0.0.0:8787",
    "127.0.0.1:8788",
    "https://127.0.0.1:8787",
  ])
    assert.throws(() => assertTunnelTarget({ tunnels: [tunnel(addr)] }));
});

test("rejects any extra tunnel to a non-gateway target", () => {
  assert.throws(() =>
    assertTunnelTarget({
      tunnels: [
        tunnel("127.0.0.1:8787"),
        tunnel("127.0.0.1:4000", "http://other.ngrok.app"),
      ],
    }),
  );
});

test("rejects inspection, production origin and missing HTTPS", () => {
  assert.throws(() =>
    assertTunnelTarget({
      tunnels: [
        {
          ...tunnel("127.0.0.1:8787"),
          config: { addr: "127.0.0.1:8787", inspect: true },
        },
      ],
    }),
  );
  assert.throws(() =>
    assertTunnelTarget({
      tunnels: [tunnel("127.0.0.1:8787", "https://mcp.holymedia.kz")],
    }),
  );
  assert.throws(() =>
    assertTunnelTarget({
      tunnels: [tunnel("127.0.0.1:8787", "http://disposable.ngrok.app")],
    }),
  );
});
