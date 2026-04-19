# Changelog

All notable changes to the monorepo are tracked here. Per-package changelogs live alongside each package.

The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `@crashwatch/provider-sentry` 0.1.0-alpha.0: Sentry provider backed by the
  public REST API. Implements `listIssues`, `getIssue`, `listEvents` with
  cursor-based pagination (`Link: rel="next"`) and jittered exponential backoff
  on 429 / 503. Advertises the `pagination` and `signals` capabilities —
  `SentryIssue.isRegressed → SIGNAL_REGRESSED`, `firstSeen` inside the current
  window → `SIGNAL_EARLY` — so the default detector alerts on regressions
  directly without requiring a 7-day snapshot history. Sentry statuses map as
  `unresolved → open`, `resolved → closed`, `ignored → muted`,
  `reprocessing → unknown`. 58 tests cover the fetch wrapper (Link-header
  parsing, retry/backoff, auth), mappers (status, signals, stack-frame
  ordering, breadcrumbs), and provider contract (URL shape, pagination cap,
  project fallback, 404 handling).
- Example `examples/single-app/config.yaml` gained a Sentry variant alongside
  the Firebase example.
- Initial monorepo scaffold.
- `@crashwatch/core` 0.1.0-alpha.0: types, config loader, JSONL store, default detector, plugin interfaces.
- `@crashwatch/cli` 0.1.0-alpha.0: `init`, `validate`, `check` commands; `--config`, `--state`, `--dry-run`, `--json` options.
- `@crashwatch/provider-firebase` 0.1.0-alpha.0: provider skeleton with `firebase-cli` and `bigquery` mode stubs.
- `@crashwatch/notifier-webhook` 0.1.0-alpha.0: generic HTTP POST notifier with optional Slack Incoming-Webhook formatting.
- `@crashwatch/notifier-slack` 0.1.0-alpha.0: convenience wrapper around the webhook notifier.
- JSON Schema at `schemas/config.schema.json`.
- Example at `examples/single-app/config.yaml`.
- Documentation scaffolding under `docs/`.

### Changed
- `@crashwatch/provider-firebase` now implements `listIssues`, `listEvents`, and
  `getReport` against the Firebase Crashlytics BigQuery export. Parameterized
  SQL is in `packages/provider-firebase/src/sql.ts`; row → core-type mappers
  are in `packages/provider-firebase/src/mappers.ts`.
- The experimental `firebase-cli` mode was removed. Firebase does not publish
  a stable public API for Crashlytics issue/event listing, so the export is
  now the sole supported backend for this provider.

### Added (tests)
- `tsx` + Node `--test` suites across every package.
- `@crashwatch/core`: 28 tests — `expandEnv`, `loadConfig` (YAML/JSON,
  validation errors), `defaultDetector` (new_issue / spike / regression /
  precedence), `JsonlSnapshotStore` (round-trip, tail limit, safe filename).
- `@crashwatch/provider-firebase`: 37 tests — mapper shape tolerance,
  table-id injection guard, `FirebaseProvider` contract driven by an
  injected fake `BigqueryClient` (SQL rendering, `issueId` filter toggle,
  report dispatch, capability advertisement, missing-option errors).
- `@crashwatch/cli`: end-to-end `check` smoke against fixture provider +
  notifier plugins — first-run `new_issue` alert, `--dry-run` suppression,
  cross-run history consumption without false alerts.
- `.github/workflows/ci.yml` now runs `pnpm test`.

### Changed
- `Issue` gained optional `recentEvents` / `recentImpactedUsers`: providers
  that compute counts server-side can attach them in one `listIssues`
  query. `@crashwatch/provider-firebase` populates them from
  `LIST_ISSUES_SQL`; the CLI `check` command prefers them to an N+1
  `listEvents` fallback.

### Known limitations
- Detector only compares against same-weekday snapshots; other baselines TBD.
- Provider signals (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`) are not present in the
  BigQuery export; detection leans on events / impacted users counts.
