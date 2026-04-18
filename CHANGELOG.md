# Changelog

All notable changes to the monorepo are tracked here. Per-package changelogs live alongside each package.

The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

### Known limitations
- Detector only compares against same-weekday snapshots; other baselines TBD.
- No integration tests yet.
- Provider signals (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`) are not present in the
  BigQuery export; detection leans on events / impacted users counts.
