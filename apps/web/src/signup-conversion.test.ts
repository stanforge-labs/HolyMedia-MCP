import { describe, expect, it, vi } from "vitest";
import {
  measureSuccessfulSignup,
  signupConversionConfig,
} from "../app/components/signup-conversion";

const config = { conversionId: "AW-123456789", label: "Signup_Label-1" };

function fakeBrowser(options?: { load?: boolean; storageFails?: boolean }) {
  const values = new Map<string, string>();
  const scripts: Array<{
    src: string;
    onload?: () => void;
    onerror?: () => void;
  }> = [];
  const browser = {
    location: {
      origin: "https://example.test",
      pathname: "/auth",
      search: "?mode=signup&oauth_transaction=private",
    },
    localStorage: {
      getItem: vi.fn((key: string) => {
        if (options?.storageFails) throw new Error("storage blocked");
        return values.get(key) ?? null;
      }),
      setItem: vi.fn((key: string, value: string) => {
        if (options?.storageFails) throw new Error("storage blocked");
        values.set(key, value);
      }),
    },
    document: {
      createElement: vi.fn(() => ({ src: "", async: false })),
      head: {
        appendChild: vi.fn((script: (typeof scripts)[number]) => {
          scripts.push(script);
          queueMicrotask(() =>
            options?.load === false ? script.onerror?.() : script.onload?.(),
          );
        }),
      },
    },
    setTimeout,
    clearTimeout,
  };
  return { browser: browser as unknown as Window, values, scripts };
}

describe("success-only Google Ads signup conversion boundary", () => {
  it("remains disabled with missing flag, ID, label, malformed values or restricted TEST", () => {
    expect(signupConversionConfig({})).toBeNull();
    expect(signupConversionConfig({ enabled: "true" })).toBeNull();
    expect(
      signupConversionConfig({
        enabled: "true",
        conversionId: "AW-123456789",
        label: "email@example.test",
      }),
    ).toBeNull();
    expect(
      signupConversionConfig({
        enabled: "true",
        conversionId: config.conversionId,
        label: config.label,
        restrictedTestAuth: "true",
      }),
    ).toBeNull();
    expect(
      signupConversionConfig({
        enabled: "true",
        conversionId: config.conversionId,
        label: config.label,
      }),
    ).toEqual(config);
  });

  it("loads no Google resource without consent, configuration and successful API identity", async () => {
    const f = fakeBrowser();
    expect(await measureSuccessfulSignup(null, true, "u", "w", f.browser)).toBe(
      "disabled",
    );
    expect(
      await measureSuccessfulSignup(config, false, "u", "w", f.browser),
    ).toBe("no-consent");
    expect(
      await measureSuccessfulSignup(config, true, undefined, "w", f.browser),
    ).toBe("invalid-success");
    expect(f.scripts).toHaveLength(0);
    expect(f.values.size).toBe(0);
  });

  it("queues one conversion after consent and successful signup, without PII or query data", async () => {
    const f = fakeBrowser();
    expect(
      await measureSuccessfulSignup(
        config,
        true,
        "user-1",
        "workspace-1",
        f.browser,
      ),
    ).toBe("queued");
    expect(f.scripts).toHaveLength(1);
    expect(f.scripts[0]?.src).toBe(
      "https://www.googletagmanager.com/gtag/js?id=AW-123456789",
    );
    const commands = (f.browser as Window & { dataLayer: unknown[][] })
      .dataLayer;
    expect(commands.find((args) => args[0] === "event")).toEqual([
      "event",
      "conversion",
      expect.objectContaining({
        send_to: "AW-123456789/Signup_Label-1",
        page_location: "https://example.test/auth",
        event_timeout: 1200,
        event_callback: expect.any(Function),
      }),
    ]);
    expect(JSON.stringify(commands)).not.toMatch(
      /owner@|password|private|user-1|workspace-1/,
    );
    expect(
      await measureSuccessfulSignup(
        config,
        true,
        "user-1",
        "workspace-1",
        f.browser,
      ),
    ).toBe("duplicate");
    expect(f.scripts).toHaveLength(1);
  });

  it("fails closed if durable deduplication is unavailable", async () => {
    const f = fakeBrowser({ storageFails: true });
    expect(
      await measureSuccessfulSignup(
        config,
        true,
        "user-1",
        "workspace-1",
        f.browser,
      ),
    ).toBe("failed");
    expect(f.scripts).toHaveLength(0);
  });

  it("never retries after a failed tag load", async () => {
    const f = fakeBrowser({ load: false });
    expect(
      await measureSuccessfulSignup(
        config,
        true,
        "user-1",
        "workspace-1",
        f.browser,
      ),
    ).toBe("failed");
    expect(
      await measureSuccessfulSignup(
        config,
        true,
        "user-1",
        "workspace-1",
        f.browser,
      ),
    ).toBe("duplicate");
    expect(f.scripts).toHaveLength(1);
  });
});
