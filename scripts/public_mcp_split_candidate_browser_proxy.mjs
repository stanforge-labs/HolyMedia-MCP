// CI-only loopback ingress to one internal-network candidate Web container.
// Unlike attaching Web to an external bridge, this grants it no outbound route.
import assert from "node:assert/strict";
import net from "node:net";

assert.equal(process.env.RELEASE_CANDIDATE_DISPOSABLE, "true");
assert.equal(process.env.COMPOSE_PROJECT_NAME, "hm-public-mcp-split-ci");
assert.equal(
  process.env.SOURCE_SHA,
  "a00817b746211a295bcb966f7fd7ef12cd6178fb",
);
const address = process.env.RC_BROWSER_WEB_IP;
assert.equal(net.isIP(address), 4);
const octets = address.split(".").map(Number);
assert(
  octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168),
  "Only the inspected disposable Web private IP may be targeted",
);
const server = net.createServer((client) => {
  const upstream = net.connect({ host: address, port: 3000 });
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  client.pipe(upstream).pipe(client);
});
server.on("error", (error) => {
  console.error(`CI Web loopback proxy failed: ${error.code}`);
  process.exitCode = 1;
});
server.listen(3000, "127.0.0.1", () => {
  console.log(
    "CI loopback ingress ready; internal Web network remains isolated",
  );
});
process.once("SIGTERM", () => server.close());
