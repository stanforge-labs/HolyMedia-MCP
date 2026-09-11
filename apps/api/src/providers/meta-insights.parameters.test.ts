import { describe, it, expect } from "vitest";
import { metaInsightsParameters } from "./meta-insights.parameters.js";
describe("Meta Insights request contract", () => {
  it.each([
    "reach",
    "frequency",
    "actions",
    "action_values",
    "cost_per_action_type",
  ])("retains requested %s", (metric) =>
    expect(metaInsightsParameters({ metrics: [metric] }).metrics).toEqual([
      metric,
    ]),
  );
  it("rejects arbitrary metric strings", () =>
    expect(() =>
      metaInsightsParameters({ metrics: ["access_token"] }),
    ).toThrow());
  it("rejects incompatible breakdown combinations", () =>
    expect(() =>
      metaInsightsParameters({ breakdowns: ["age", "country"] }),
    ).toThrow());
  it.each([
    ["last_7d", "2026-09-04"],
    ["last_14d", "2026-08-28"],
    ["last_30d", "2026-08-12"],
  ])("honors %s", (preset, start) =>
    expect(
      metaInsightsParameters(
        { date_preset: preset },
        false,
        new Date("2026-09-11T10:00:00Z"),
      ).range,
    ).toEqual({ startDate: start, endDate: "2026-09-10" }),
  );
  it("does not silently replace malformed explicit dates", () => {
    expect(() =>
      metaInsightsParameters({ since: "2026-02-30", until: "2026-03-01" }),
    ).toThrow();
    expect(() => metaInsightsParameters({ since: "2026-01-01" })).toThrow();
    expect(() =>
      metaInsightsParameters({ date_preset: "last_7d", since: "2026-01-01" }),
    ).toThrow();
  });
});
