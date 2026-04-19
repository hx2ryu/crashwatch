import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  buildIssueDetail,
  mapStatus,
  sentryEventToCrashEvent,
  sentryIssueToIssue,
  type SentryEvent,
  type SentryIssue,
} from "../mappers.js";

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("mapStatus", () => {
  test("unresolved → open", () => assert.equal(mapStatus("unresolved"), "open"));
  test("resolved → closed", () => assert.equal(mapStatus("resolved"), "closed"));
  test("ignored → muted", () => assert.equal(mapStatus("ignored"), "muted"));
  test("reprocessing → unknown", () =>
    assert.equal(mapStatus("reprocessing"), "unknown"));
  test("undefined / unrecognised → unknown", () => {
    assert.equal(mapStatus(undefined), "unknown");
    assert.equal(mapStatus("novel-state"), "unknown");
  });
});

describe("sentryIssueToIssue", () => {
  const [issue0, issue1] = fixture<SentryIssue[]>("issues.json");

  test("maps core fields from a real-ish fixture", () => {
    const out = sentryIssueToIssue(issue0!);
    assert.equal(out.id, "4123456789");
    assert.equal(out.title, issue0!.title);
    assert.equal(out.subtitle, issue0!.culprit);
    assert.equal(out.state, "open");
    assert.equal(out.url, issue0!.permalink);
    assert.equal(out.firstSeenVersion, "1.2.3");
    assert.equal(out.lastSeenVersion, "1.2.4");
    assert.equal(out.recentEvents, 42);
    assert.equal(out.recentImpactedUsers, 7);
  });

  test("parses string `count` into a number", () => {
    const out = sentryIssueToIssue({ id: "x", count: "17", userCount: 3 });
    assert.equal(out.recentEvents, 17);
  });

  test("attaches SIGNAL_REGRESSED when isRegressed=true", () => {
    const out = sentryIssueToIssue(issue0!);
    assert.ok(out.signals?.includes("SIGNAL_REGRESSED"));
  });

  test("attaches SIGNAL_EARLY when firstSeen ≥ windowStart", () => {
    const out = sentryIssueToIssue(issue0!, {
      windowStart: "2026-04-18T00:00:00Z",
    });
    assert.ok(out.signals?.includes("SIGNAL_EARLY"));
  });

  test("does NOT attach SIGNAL_EARLY when firstSeen is older than window", () => {
    const out = sentryIssueToIssue(issue1!, {
      windowStart: "2026-04-18T00:00:00Z",
    });
    assert.equal(Boolean(out.signals?.includes("SIGNAL_EARLY")), false);
  });

  test("maps ignored status to muted", () => {
    const out = sentryIssueToIssue(issue1!);
    assert.equal(out.state, "muted");
  });

  test("inferErrorType: isUnhandled → fatal", () => {
    const out = sentryIssueToIssue({
      id: "x",
      level: "error",
      isUnhandled: true,
    });
    assert.equal(out.errorType, "fatal");
  });

  test("inferErrorType: level=fatal → fatal even without isUnhandled", () => {
    const out = sentryIssueToIssue({ id: "x", level: "fatal" });
    assert.equal(out.errorType, "fatal");
  });

  test("inferErrorType: no level → unknown", () => {
    const out = sentryIssueToIssue({ id: "x" });
    assert.equal(out.errorType, "unknown");
  });

  test("falls back to '(untitled)' when title missing", () => {
    const out = sentryIssueToIssue({ id: "x" });
    assert.equal(out.title, "(untitled)");
  });

  test("signals array is omitted when empty", () => {
    const out = sentryIssueToIssue({ id: "x", status: "unresolved" });
    assert.equal(out.signals, undefined);
  });

  test("raw payload is preserved for debugging", () => {
    const out = sentryIssueToIssue(issue0!);
    assert.equal(out.raw, issue0);
  });
});

describe("sentryEventToCrashEvent", () => {
  const [event] = fixture<SentryEvent[]>("events.json");

  test("pulls appVersion from contexts.app first", () => {
    const out = sentryEventToCrashEvent(event!);
    assert.equal(out.appVersion, "1.2.3");
  });

  test("maps device + os from contexts", () => {
    const out = sentryEventToCrashEvent(event!);
    assert.equal(out.device?.manufacturer, "samsung");
    assert.equal(out.device?.model, "SM-S938N");
    assert.equal(out.device?.marketingName, "Galaxy S25");
    assert.equal(out.os?.name, "Android");
    assert.equal(out.os?.version, "16");
  });

  test("reverses stack frames so the crashing frame is first", () => {
    const out = sentryEventToCrashEvent(event!);
    assert.equal(out.stackFrames?.length, 2);
    assert.equal(out.stackFrames?.[0]?.symbol, "onResume");
    assert.equal(out.stackFrames?.[0]?.file, "FeedFragment.kt");
    assert.equal(out.stackFrames?.[0]?.line, 128);
    assert.equal(out.stackFrames?.[1]?.symbol, "invoke");
  });

  test("maps breadcrumbs to { timestamp, name, data }", () => {
    const out = sentryEventToCrashEvent(event!);
    assert.equal(out.breadcrumbs?.length, 2);
    assert.equal(out.breadcrumbs?.[0]?.name, "navigate /feed");
    assert.equal(out.breadcrumbs?.[0]?.timestamp, "2026-04-19T11:59:50Z");
  });

  test("synthesises an event id when missing", () => {
    const out = sentryEventToCrashEvent({
      groupID: "g1",
      dateCreated: "2026-04-19T00:00:00Z",
    });
    assert.equal(out.id, "g1:2026-04-19T00:00:00Z");
  });

  test("omits device / os when neither manufacturer/model/version is present", () => {
    const out = sentryEventToCrashEvent({
      groupID: "g",
      contexts: { device: {} as unknown as never, os: {} as unknown as never },
    });
    assert.equal(out.device, undefined);
    assert.equal(out.os, undefined);
  });

  test("handles missing exception entry gracefully", () => {
    const out = sentryEventToCrashEvent({
      groupID: "g",
      entries: [{ type: "breadcrumbs", data: { values: [] } }],
    });
    assert.equal(out.stackFrames, undefined);
  });
});

describe("buildIssueDetail", () => {
  test("returns the base issue when no sample is given", () => {
    const issue = sentryIssueToIssue({ id: "x", title: "t" });
    const detail = buildIssueDetail(issue);
    assert.equal(detail.sampleEvent, undefined);
    assert.equal(detail.id, "x");
  });

  test("attaches a converted sample event", () => {
    const issue = sentryIssueToIssue({ id: "x", title: "t" });
    const [sample] = fixture<SentryEvent[]>("events.json");
    const detail = buildIssueDetail(issue, sample);
    assert.equal(detail.sampleEvent?.id, "e1111111111111111111111111111111");
  });
});
