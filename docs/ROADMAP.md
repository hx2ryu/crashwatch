# Roadmap

Public roadmap for crashwatch. Short-term, session-to-session working notes live in [`../NEXT-SESSION.md`](../NEXT-SESSION.md); this document is the version written for readers outside my own head.

## Status: pre-alpha

crashwatch is pre-alpha. The `CrashProvider`, `Notifier`, and `IssueTracker` interfaces will change as new providers stress-test them, and nothing has been published to npm yet. Milestones below are directional, not committed dates — this is a personal-time project.

## 0.1 (current)

Shipped, in the tree today:

- **Two providers.** `@hx2ryu/crashwatch-provider-firebase` runs parameterized SQL against the Firebase Crashlytics → BigQuery export. `@hx2ryu/crashwatch-provider-sentry` talks to the public Sentry REST API with cursor pagination and jittered backoff on 429 / 503.
- **Two notifiers.** `@hx2ryu/crashwatch-notifier-webhook` POSTs JSON alerts to any URL; `@hx2ryu/crashwatch-notifier-slack` is a thin wrapper that pre-selects the Slack Incoming Webhook body template.
- **CLI.** `@hx2ryu/crashwatch-cli` ships `crashwatch init`, `validate`, and `check` with `--config`, `--state`, `--dry-run`, `--json` options. Plugins are resolved at runtime via `import()` by module specifier or local path.
- **Detector.** `defaultDetector` emits three alert kinds: `new_issue` (absent from history + above threshold), `spike` (same-weekday baseline comparison), `regression` (provider-emitted signal).
- **Store.** `JsonlSnapshotStore` appends snapshots and alerts to disk as JSONL — inspectable, diff-able, never rewritten in place.
- **Tests.** 129 tests across the six packages, running under `tsx` + `node --test`. GitHub Actions runs `pnpm install / build / typecheck / test` on every push and is currently green.

## 0.2

Near-term work, aimed at validating the plugin interfaces before they solidify:

- `@hx2ryu/crashwatch-tracker-github-issues` — the simplest real tracker to build, validates the `IssueTracker` shape on actual traffic, and is the one a small team is most likely to adopt.
- Detector extensions: a `resurfaced` alert kind (closed/muted issue with new events), and a prior-release baseline so spikes can be scoped to the version that actually shipped.
- Pluggable detector via config (`detector: { plugin: ... }`) so teams can replace or extend the default rules without forking core.
- Per-package READMEs for every package in the tree — partly landing alongside this roadmap.
- First `pnpm -r publish --dry-run` to shake out npm metadata before the real publish.

## 1.0

Longer horizon. These are the criteria for promoting out of alpha, not features:

- Live-backend smoke tests validated against a real Firebase Crashlytics export and a real Sentry org, so the mappers are proven against production schemas instead of only against recorded fixtures.
- `CrashProvider`, `Notifier`, and `IssueTracker` interfaces held stable across two minor cycles with a documented migration path for anything that did change.
- A docs site if the scope outgrows the current `docs/` folder; not a goal on its own.
- Additional provider candidates (Bugsnag, Rollbar). **Not committed** — a provider ships when an end user of that product is interested enough to help.

## Beyond 1.0

Speculative; may or may not happen:

- Tracker plugins for Jira and Linear.
- Third-party / community detector plugins beyond the defaults — domain-specific rules (e.g. crash-free-session SLO burn rate, platform-specific regressions).
- Scheduled runs from inside crashwatch itself (today the expectation is an external cron / CI / systemd timer).

## Non-goals

Things crashwatch will deliberately not do, so the scope stays legible:

- **No hosted product.** crashwatch is software you run against your own stores and tokens. If you want a SaaS, the vendors already make excellent ones.
- **No vendor logic in `@hx2ryu/crashwatch-core`.** The core never imports a vendor SDK and never names a specific product in its types. Vendor code lives in plugins, always.
- **No bundled dashboard.** crashwatch is plumbing — it pipes crash signals into the dashboards and channels your team already has (Slack, Jira, Grafana, PagerDuty via webhook, your own intake endpoint). Building yet another UI is not the value-add.
- **No client-side crash ingestion.** crashwatch is a consumer of crash data, not a reporter. Keep using Crashlytics / Sentry / Bugsnag for capture; crashwatch starts where they stop.
