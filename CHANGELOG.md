# Changelog

All notable changes to the monorepo are tracked here. Per-package changelogs live alongside each package.

The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Semver-aware version comparison in the detector.** The prior-release
  spike baseline now parses `major.minor.patch[-prerelease][+build]` and
  compares numerically — fixing the motivating bug where plain string
  compare ranked `"1.10.0" < "1.2.0"` and silently suppressed the baseline.
  Prereleases rank lower than the same tuple without them (semver §11);
  build metadata is ignored (§10); leading `v` is stripped; unparseable
  strings (commit SHAs, etc.) fall back to plain string compare so odd
  provider outputs still get *some* ordering. `compareVersions(a, b)` is
  exported from `@crashwatch/core` for reuse in custom detectors. +9 core
  tests (47 total).
- **npm publish metadata for all 7 publishable packages.** Every
  `packages/*/package.json` now carries `publishConfig.access: "public"`
  (required so the first publish of a scoped package doesn't 403),
  `repository` with a `directory` pointer so npm's "Source" link resolves to
  the right subtree, `homepage` pointing at each package's README anchor,
  `bugs.url`, and a minimal 3-6 term `keywords` list. The `files` whitelist
  now excludes `dist/__tests__` and `*.tsbuildinfo` so compiled tests don't
  leak into tarballs. Root `package.json` picked up matching top-level
  `repository` / `homepage` / `bugs`. `pnpm -r publish --dry-run --access
  public` verified clean across all 7 packages: 2.7 kB–18.8 kB per tarball,
  no test files in any tarball, and pnpm's `workspace:*` → `0.1.0-alpha.0`
  rewrite confirmed in both `dependencies` and `peerDependencies`. The real
  publish is an explicit later step.
- **Pluggable detector via config.** `CrashwatchConfig` gained an optional
  `detector: { plugin, options? }` field. When set, `crashwatch check`
  resolves the detector plugin the same way it resolves providers /
  notifiers / trackers (`import()`, default export or `createPlugin` named
  export) and uses it in place of `defaultDetector`. The new `DetectorFactory`
  type is exported from `@crashwatch/core`. JSON Schema updated with a
  `detectorRef` definition. Two new CLI e2e tests: explicit plugin path is
  routed correctly; omitting the field still falls back to `defaultDetector`.
- `@crashwatch/tracker-github-issues` 0.1.0-alpha.0: GitHub Issues tracker
  plugin. Implements the `IssueTracker` interface with a pure-`fetch` client,
  jittered exponential backoff on 429 / 502 / 503 (honouring `Retry-After`),
  and clear 401 / 403 error messages. Per-alert `owner` / `repo` / `labels` /
  `assignees` overrides fully replace tracker-level defaults. Returns the
  created issue's `html_url` so the runner can record it on the alert for
  downstream dedup. 41 tests cover the API wrapper, tracker contract, body
  formatting, and failure modes.
- `@crashwatch/core` `defaultDetector` gained two new rules:
  `resurfaced` (closed issue picking up fresh events in history) and a
  `prior-release` baseline path for `spike` (compares against the most recent
  history snapshot whose `lastSeenVersion` was strictly older than the
  current one). Alerts from either spike path now carry
  `baselineSource: "week_over_week" | "prior_release"` in their context so
  notifiers can disambiguate. +10 tests.
- `docs/ROADMAP.md` rewritten as a public, reader-facing roadmap (pre-alpha
  disclaimer + `0.1 (current)` / `0.2` / `1.0` / `Beyond 1.0` / `Non-goals`).
- Per-package READMEs for `@crashwatch/core`, `@crashwatch/cli`,
  `@crashwatch/notifier-webhook`, and `@crashwatch/notifier-slack`, matching
  the tone of the existing provider-firebase / provider-sentry READMEs.
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
- CI workflow bumped to `actions/checkout@v6`, `actions/setup-node@v6`
  (Node 22 LTS), and `pnpm/action-setup@v5` to silence GitHub's Node 20
  deprecation annotation. All three new majors run on Node 24, which is
  where GH runners are headed for the 2026-09 cutover.
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
- Provider signals (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`) are not present in the
  BigQuery export; detection leans on events / impacted users counts. Sentry
  does expose these and populates them directly.
- Nothing has been published to npm yet. Dry-run is clean for 0.1.0-alpha.0;
  the actual `pnpm -r publish --access public` is gated on human sign-off.
