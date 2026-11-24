import { describe, expect, it } from "vitest";
import { byDay } from "../dashboard/src/lib/feed";

describe("dashboard feed", () => {
  it("groups uploads by day and folds a doc's earlier uploads that day under its newest", () => {
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
    const uploads = [
      { doc: "a", n: 3, createdAt: at(24, 19) },
      { doc: "b", n: 1, createdAt: at(24, 18) },
      { doc: "a", n: 2, createdAt: at(24, 9) },
      { doc: "a", n: 1, createdAt: at(23, 23) },
    ];
    const days = byDay(uploads, (u) => u.doc);
    expect(days.map((d) => [new Date(d.day).getDate(), d.count, d.entries.map((e) => [e.head.doc + e.head.n, e.older.map((o) => o.n)])])).toEqual([
      [24, 3, [["a3", [2]], ["b1", []]]],
      [23, 1, [["a1", []]]],
    ]);
  });
});
