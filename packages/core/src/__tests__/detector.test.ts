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

  test("resurfaced fires when history shows issue as closed and current has events", () => {
    const threeDaysAgo = iso(3 * 24 * 60 * 60 * 1000);
    const history = [
      snapshot(threeDaysAgo, [
        { issue: issue("A", { state: "closed" }), events: 0 },
      ]),
    ];
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 2 }]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const resurfaced = alerts.find((a) => a.kind === "resurfaced");
    assert.ok(resurfaced, "expected resurfaced alert");
    assert.equal(resurfaced!.level, "warning");
    assert.equal((resurfaced!.context as { events: number }).events, 2);
  });

  test("resurfaced does NOT fire when history only shows state: open", () => {
    const threeDaysAgo = iso(3 * 24 * 60 * 60 * 1000);
    const history = [
      snapshot(threeDaysAgo, [
        { issue: issue("A", { state: "open" }), events: 5 },
      ]),
    ];
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 2 }]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    assert.equal(alerts.filter((a) => a.kind === "resurfaced").length, 0);
  });

  test("resurfaced does NOT fire when history is empty", () => {
    // With empty history, issue is brand new — new_issue path, not resurfaced.
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 2 }]);
    const alerts = defaultDetector(current, [], THRESHOLDS);
    assert.equal(alerts.filter((a) => a.kind === "resurfaced").length, 0);
  });

  test("regression signal takes precedence over resurfaced when both would qualify", () => {
    const threeDaysAgo = iso(3 * 24 * 60 * 60 * 1000);
    const history = [
      snapshot(threeDaysAgo, [
        { issue: issue("A", { state: "closed" }), events: 0 },
      ]),
    ];
    const current = snapshot(iso(0), [
      {
        issue: issue("A", { signals: ["SIGNAL_REGRESSED"] }),
        events: 2,
      },
    ]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const kinds = alerts.map((a) => a.kind).sort();
    assert.deepEqual(kinds, ["regression"]);
  });

  test("prior-release spike fires when lastSeenVersion changed and delta >= threshold", () => {
    const twoDaysAgo = iso(2 * 24 * 60 * 60 * 1000);
    const history = [
      snapshot(twoDaysAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.3" }),
          events: 100,
        },
      ]),
    ];
    const current = snapshot(iso(0), [
      { issue: issue("A", { lastSeenVersion: "1.2.4" }), events: 130 },
    ]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const spike = alerts.find((a) => a.kind === "spike");
    assert.ok(spike, "expected spike alert from prior-release baseline");
    const ctx = spike!.context as {
      baselineSource: string;
      baselineVersion: string;
      deltaPct: number;
    };
    assert.equal(ctx.baselineSource, "prior_release");
    assert.equal(ctx.baselineVersion, "1.2.3");
    assert.equal(ctx.deltaPct, 30);
  });

  test("prior-release spike does NOT fire when versions are equal", () => {
    const twoDaysAgo = iso(2 * 24 * 60 * 60 * 1000);
    const history = [
      snapshot(twoDaysAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.4" }),
          events: 100,
        },
      ]),
    ];
    const current = snapshot(iso(0), [
      { issue: issue("A", { lastSeenVersion: "1.2.4" }), events: 130 },
    ]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    // No week-over-week baseline either (snapshot isn't a week old), so no spike.
    assert.equal(alerts.filter((a) => a.kind === "spike").length, 0);
  });

  test("prior-release spike does NOT fire when current lastSeenVersion is undefined", () => {
    const twoDaysAgo = iso(2 * 24 * 60 * 60 * 1000);
    const history = [
      snapshot(twoDaysAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.3" }),
          events: 100,
        },
      ]),
    ];
    const current = snapshot(iso(0), [
      { issue: issue("A"), events: 130 },
    ]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    assert.equal(alerts.filter((a) => a.kind === "spike").length, 0);
  });

  test("when both baselines fire, only ONE spike alert is emitted (larger delta wins)", () => {
    const weekAgo = iso(7 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = iso(2 * 24 * 60 * 60 * 1000);
    const history: Snapshot[] = [
      // Week-over-week: 100 -> 130 => 30% delta.
      snapshot(weekAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.3" }),
          events: 100,
        },
      ]),
      // Prior-release: 50 -> 130 => 160% delta (bigger).
      snapshot(twoDaysAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.3" }),
          events: 50,
        },
      ]),
    ];
    const current = snapshot(iso(0), [
      { issue: issue("A", { lastSeenVersion: "1.2.4" }), events: 130 },
    ]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const spikes = alerts.filter((a) => a.kind === "spike");
    assert.equal(spikes.length, 1, "expected exactly one spike alert");
    const ctx = spikes[0]!.context as {
      baselineSource: string;
      deltaPct: number;
    };
    assert.equal(ctx.baselineSource, "prior_release");
    assert.equal(ctx.deltaPct, 160);
  });

  test("baselineSource is populated on week-over-week spike alerts too", () => {
    const weekAgo = iso(7 * 24 * 60 * 60 * 1000);
    const history: Snapshot[] = [
      snapshot(weekAgo, [{ issue: issue("A"), events: 100 }]),
    ];
    const current = snapshot(iso(0), [{ issue: issue("A"), events: 130 }]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const spike = alerts.find((a) => a.kind === "spike");
    assert.ok(spike, "expected spike alert");
    const ctx = spike!.context as { baselineSource: string };
    assert.equal(ctx.baselineSource, "week_over_week");
  });

  test("prior-release path uses the LATEST history snapshot with an older version", () => {
    const fiveDaysAgo = iso(5 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = iso(2 * 24 * 60 * 60 * 1000);
    const history: Snapshot[] = [
      // Older snapshot on same old version — should NOT be chosen.
      snapshot(fiveDaysAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.3" }),
          events: 10,
        },
      ]),
      // Latest snapshot on a still-older version — should be chosen.
      snapshot(twoDaysAgo, [
        {
          issue: issue("A", { lastSeenVersion: "1.2.3" }),
          events: 100,
        },
      ]),
    ];
    const current = snapshot(iso(0), [
      { issue: issue("A", { lastSeenVersion: "1.2.4" }), events: 130 },
    ]);
    const alerts = defaultDetector(current, history, THRESHOLDS);
    const spike = alerts.find((a) => a.kind === "spike");
    assert.ok(spike);
    const ctx = spike!.context as { baselineEvents: number };
    assert.equal(ctx.baselineEvents, 100);
  });
});
