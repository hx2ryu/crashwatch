import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { DEFAULT_THRESHOLDS, type Thresholds } from "../config.js";
import { defaultDetector } from "../detector.js";
import type { Issue, Snapshot } from "../types.js";

const THRESHOLDS: Thresholds = { ...DEFAULT_THRESHOLDS };

function iso(offsetMs: number, from = Date.now()): string {
  return new Date(from - offsetMs).toISOString();
}

function issue(
  id: string,
  overrides: Partial<Issue> = {},
): Issue {
  return {
    id,
    title: `Issue ${id}`,
    errorType: "fatal",
    state: "open",
    ...overrides,
  };
}

function snapshot(
  at: string,
  entries: Array<{ issue: Issue; events: number }>,
): Snapshot {
  return {
    capturedAt: at,
    appName: "app",
    platform: "android",
    issues: entries.map(({ issue, events }) => ({
      issue,
      recent: {
        windowStart: iso(24 * 60 * 60 * 1000, Date.parse(at)),
        windowEnd: at,
        events,
      },
    })),
  };
}

describe("defaultDetector", () => {
  test("emits new_issue when id is absent from history and events >= threshold", () => {
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 10 }]);
    const alerts = defaultDetector(current, [], THRESHOLDS);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.kind, "new_issue");
    assert.equal(alerts[0]!.level, "warning");
    assert.equal(alerts[0]!.appName, "app");
  });

  test("skips new_issue when events below threshold", () => {
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 1 }]);
    const alerts = defaultDetector(current, [], THRESHOLDS);
    assert.equal(alerts.length, 0);
  });

  test("emits spike when a week-old baseline exists and events grow >= threshold", () => {
    const weekAgo = iso(7 * 24 * 60 * 60 * 1000);
    const now = iso(0);
    const history: Snapshot[] = [
      snapshot(weekAgo, [{ issue: issue("A"), events: 100 }]),
    ];
    const current = snapshot(now, [{ issue: issue("A"), events: 130 }]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const spike = alerts.find((a) => a.kind === "spike");
    assert.ok(spike, "expected spike alert");
    assert.equal(spike!.level, "critical");
    assert.equal((spike!.context as { deltaPct: number }).deltaPct, 30);
  });

  test("no spike when growth below threshold", () => {
    const weekAgo = iso(7 * 24 * 60 * 60 * 1000);
    const history: Snapshot[] = [
      snapshot(weekAgo, [{ issue: issue("A"), events: 100 }]),
    ];
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 110 }]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    assert.equal(alerts.filter((a) => a.kind === "spike").length, 0);
  });

  test("regression signal always alerts regardless of counts", () => {
    const current = snapshot(iso(0), [
      { issue: issue("A", { signals: ["SIGNAL_REGRESSED"] }), events: 1 },
    ]);
    const alerts = defaultDetector(current, [], THRESHOLDS);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.kind, "regression");
  });

  test("skips spike path when issue is truly new (new_issue takes precedence)", () => {
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 999 }]);
    const alerts = defaultDetector(current, [], THRESHOLDS);
    // Only one alert — new_issue — not spike.
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.kind, "new_issue");
  });

  test("no alert when nothing is interesting", () => {
    const weekAgo = iso(7 * 24 * 60 * 60 * 1000);
    const history = [snapshot(weekAgo, [{ issue: issue("A"), events: 100 }])];
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 100 }]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    assert.equal(alerts.length, 0);
  });

  test("regression + new_issue can fire together when signal and first-sight coincide", () => {
    const current = snapshot(iso(0), [
      {
        issue: issue("A", { signals: ["SIGNAL_EARLY"] }),
        events: 10,
      },
    ]);
    const alerts = defaultDetector(current, [], THRESHOLDS);
    const kinds = alerts.map((a) => a.kind).sort();
    assert.deepEqual(kinds, ["new_issue", "regression"]);
  });
});
