# Roadmap

Public, long-horizon roadmap for crashwatch. For short-term session-to-session working notes, see [`../NEXT-SESSION.md`](../NEXT-SESSION.md).

Versioning is independent per package, but milestones below are tracked at the repo level. Dates are targets, not commitments; this is a personal-time project.

---

## 0.1.0-alpha — *Scaffold*  (shipped)

Goals: prove the plugin architecture with one real provider, one real notifier, and a working CLI runner.

- [x] Vendor-neutral `@crashwatch/core` (types, config, detector, JSONL store, plugin interfaces)
- [x] `@crashwatch/cli` with `init`, `validate`, `check` (`--dry-run`, `--json`, `--state`)
- [x] `@crashwatch/provider-firebase` via BigQuery export (stable path)
- [x] `@crashwatch/notifier-webhook` + `@crashwatch/notifier-slack`
- [x] 71 tests across packages; GitHub Actions CI green
- [x] MIT license, contributing guide, JSON Schema for config

---

## 0.2.0-alpha — *Second provider, first tracker*

Goals: validate the abstractions with a second real provider before the API solidifies, and let alerts flow into an issue tracker.

- [ ] `@crashwatch/provider-sentry` (REST API, signals, pagination)
- [ ] Update `CrashProvider` interface only if a real shape gap forces it
- [ ] `@crashwatch/tracker-github-issues` (create + deduplicate on `crashlyticsIssueId` or equivalent key)
- [ ] End-to-end example: Sentry → webhook → tracker
- [ ] Per-package `README.md` for core, cli, notifier-webhook, notifier-slack
- [ ] Live BigQuery smoke run (provider-firebase) against a real export

---

## 0.3.0-alpha — *Richer detection + trackers*

Goals: push beyond "week-over-week spike" and support the trackers most teams actually use.

- [ ] Detector plugins — expose a `DetectionRule[]` contract, ship `rolling-average`, `prior-release` baselines
- [ ] `resurfaced` alert kind (closed/resolved → events > 0 again)
- [ ] `@crashwatch/tracker-linear`
- [ ] `@crashwatch/tracker-jira`
- [ ] `@crashwatch/notifier-pagerduty` (escalation policies for `critical` alerts)
- [ ] Cost-awareness docs for BigQuery mode (bytes-scanned budgets)

---

## 0.4.0-alpha — *Dogfooding + automation*

Goals: someone (most likely me) runs this in anger for long enough to find the sharp edges.

- [ ] `crashwatch compact` — roll up JSONL snapshots older than N days
- [ ] `crashwatch report` — print a readable summary from the store
- [ ] `@crashwatch/store-s3` / `@crashwatch/store-sqlite` as plugin alternatives to the default JSONL store
- [ ] Auth-token-less helper (`crashwatch auth sentry` / `firebase`) to wire credentials without editing YAML
- [ ] OpenTelemetry traces from core so runs are observable themselves

---

## 0.5.0-alpha / 0.6.0-alpha — *Quality + polish*

- [ ] `@crashwatch/provider-bugsnag`, `@crashwatch/provider-rollbar`
- [ ] SLO plugin: crash-free users/session targets per app + burn-rate alerts
- [ ] `docs/` site (mkdocs or docusaurus) with searchable plugin registry
- [ ] Tightened types — narrow `raw?: unknown` to provider-specific discriminated union in V1

---

## 1.0.0 — *Stable public API*

Criteria for promoting out of alpha:

- At least three first-party providers and two trackers shipping
- `CrashProvider`, `Notifier`, `IssueTracker` interfaces unchanged for two minor cycles
- Integration test matrix green against recorded real-world payloads for each provider
- Documented migration path from 0.x for the handful of existing users
- Semver commitment written into `CONTRIBUTING.md`

---

## Explicitly out of scope

- Ingesting crashes directly from clients — there are many excellent products for that; crashwatch is a consumer, not a reporter.
- Symbolicating native stack traces — out of our abstraction level; if anything, a provider exposes symbols already resolved (e.g. Firebase does this server-side).
- Hosted dashboards — crashwatch is designed to pipe signals into the dashboards teams already have (Slack, Jira, Grafana via webhook, etc.).
