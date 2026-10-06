import { EventEmitter } from "node:events";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { safeGet } from "./index.js";
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
afterEach(() => vi.restoreAllMocks());
function transport(status = 200, location?: string) {
  const request = vi.spyOn(https, "request").mockImplementation(((
    _url: unknown,
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    const req = Object.assign(new EventEmitter(), {
      end() {
        queueMicrotask(() => {
          const response = Object.assign(new EventEmitter(), {
            statusCode: status,
            headers: location ? { location } : {},
            socket: { remoteAddress: "93.184.216.34" },
            resume() {},
            destroy() {},
          });
          callback(response);
          queueMicrotask(() => response.emit("end"));
        });
      },
      destroy() {},
    });
    return req;
  }) as typeof https.request);
  return request;
}
describe("Read-only HEAD transport with shared SSRF guards, mocked network only", () => {
  it("HEAD stays bounded and DNS-pinned; default existing safeGet remains GET", async () => {
    const request = transport();
    await safeGet("https://example.test/", {
      headOnly: true,
      timeoutMs: 4000,
      maxBytes: 65536,
      maxRedirects: 3,
    });
    expect(request.mock.calls[0]![1]).toMatchObject({
      method: "HEAD",
      timeout: 4000,
    });
    expect(
      typeof (request.mock.calls[0]![1] as { lookup?: unknown }).lookup,
    ).toBe("function");
    await safeGet("https://example.test/");
    expect(request.mock.calls[1]![1]).toMatchObject({ method: "GET" });
  });
  it("private DNS result is rejected before transport", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ] as never);
    const request = transport();
    await expect(
      safeGet("https://example.test/", { headOnly: true }),
    ).rejects.toBeDefined();
    expect(request).not.toHaveBeenCalled();
  });
  it("redirect to private literal is rejected, and redirect loops bounded", async () => {
    let request = transport(302, "http://127.0.0.1/internal");
    await expect(
      safeGet("https://example.test/", { headOnly: true, maxRedirects: 3 }),
    ).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRestore();
    request = transport(302, "https://example.test/again");
    await expect(
      safeGet("https://example.test/", { headOnly: true, maxRedirects: 2 }),
    ).rejects.toThrow(/перенаправлений/);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
