import { describe, expect, it } from "vitest";
import { nextDaily } from "../dashboard/src/lib/format";

describe("nextDaily", () => {
  it("finds the next UTC firing of a daily cron, today or tomorrow", () => {
    expect(nextDaily("17 3 * * *", Date.UTC(2026, 10, 25, 1, 0))).toBe(Date.UTC(2026, 10, 25, 3, 17));
    expect(nextDaily("17 3 * * *", Date.UTC(2026, 10, 25, 3, 17))).toBe(Date.UTC(2026, 10, 26, 3, 17));
    expect(nextDaily("17 3 * * *", Date.UTC(2026, 11, 31, 22, 0))).toBe(Date.UTC(2027, 0, 1, 3, 17));
  });

  it("gives up on schedules that aren't once a day", () => {
    for (const cron of ["*/5 * * * *", "0 3 * * 1", null]) expect(nextDaily(cron)).toBeNull();
  });
});
