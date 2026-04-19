# Next session — resuming crashwatch

> Living document. Update the "Current state" block at the end of each
> session and edit "Next up" as tasks complete. Delete when the repo goes
> public / first 1.0 ships.

## Context for a fresh Claude / engineer

crashwatch is a pre-alpha, vendor-neutral crash observability monorepo. Core knows nothing about any specific backend; providers (`@crashwatch/provider-*`), notifiers (`@crashwatch/notifier-*`), trackers (`@crashwatch/tracker-*`) are plugins loaded by id. Design rationale in the root [README](./README.md), short version: **the core must never acquire a dependency on a specific vendor**; if a PR tempts you that way, split it into a plugin.

Repo is **private**, owned by `hx2ryu` on GitHub: https://github.com/hx2ryu/crashwatch. Local clone at `~/dev/personal/crashwatch`. License MIT.

Stack: **Node ≥ 18**, **TypeScript 5.5+**, **pnpm 9** (workspaces), **tsx + `node --test`** for tests.

## Environment expectations

All three identity layers are already configured on this machine:

- **Git commit author** — `~/.gitconfig` has `[includeIf "gitdir:~/dev/personal/"]` → `~/.gitconfig-personal` (`hx2ryu / 58078994+hx2ryu@users.noreply.github.com`).
- **gh CLI** — `~/dev/personal/.envrc` pins `GH_TOKEN` to the hx2ryu token via `direnv`. Allow with `direnv allow` on first entry.
- **Git SSH** — `~/.ssh/config` has `Host github.com-hx2ryu` → `~/.ssh/hx2ryu`. The repo remote is `git@github.com-hx2ryu:hx2ryu/crashwatch.git`.

If a new machine or clone: replicate these three, then `corepack enable && pnpm install && pnpm -r build && pnpm test`. All 71 tests should be green.

## Current state (as of 2026-04-19)

**What works end-to-end:**
- `crashwatch init / validate / check` CLI loads a YAML/JSON config, resolves plugins via `import()`, writes JSONL snapshots + alerts, dispatches notifiers.
- `@crashwatch/provider-firebase` implements `listIssues / getIssue / listEvents / getReport` against the Crashlytics BigQuery export (lazy-loads `@google-cloud/bigquery`).
- `@crashwatch/notifier-webhook` + `@crashwatch/notifier-slack` deliver alerts to a URL.
- `defaultDetector` emits `new_issue / spike / regression` using provider-supplied counts (`Issue.recentEvents`).
- 71 tests across 5 packages; GitHub Actions runs `pnpm install / -r build / typecheck / test` on every push + PR and is currently green.

**What is deferred and why:**
- No live BigQuery smoke test yet — depends on a Crashlytics export being set up.
- Only one real provider, so the `CrashProvider` interface is not yet battle-tested against shape differences across backends.
- No tracker plugins.
- Detector baseline is same-weekday-only; richer windows (rolling average, prior-release-version) are out of scope for 0.1.

**Last commits on main:**

```
942bceb test: use single-level glob in test scripts for bash compatibility
2b356d7 ci: drop pnpm version override, defer to packageManager field
7af7f94 ci: run pnpm test; docs: log test coverage + Issue change in CHANGELOG
5781c85 test: add tsx + node --test suites, wire into CI
6c4188a feat(provider-firebase): BigQuery-export implementation
1090871 chore: initial crashwatch monorepo scaffold (pre-alpha)
```

## Next up (priority order)

### 1. `@crashwatch/provider-sentry` — recommended first

Sentry publishes a stable public REST API, so this is the shortest path to a second real provider. Doing it early will pressure-test the `CrashProvider` interface against shape differences that the Firebase path alone doesn't surface (e.g. Sentry exposes first-class "regressed" signals, pagination cursors).

Suggested work:

- `packages/provider-sentry/` — same layout as provider-firebase.
- `src/api.ts` — thin `fetch` wrapper over `https://sentry.io/api/0/...`, honouring `Link: rel="next"` pagination and 429 backoff with jitter.
- `src/mappers.ts` — `SentryIssue → Issue`, `SentryEvent → CrashEvent`. Sentry's issue `status` ∈ `{unresolved, resolved, ignored, reprocessing}` maps to `Issue.state`. `SentryIssue.isRegressed` → `signals: ["SIGNAL_REGRESSED"]`, newly-seen issues → `"SIGNAL_EARLY"`, matching what the detector already understands.
- `src/index.ts` — `SentryProvider` implementing `CrashProvider`; constructor takes `{ authToken, org, project }` (plus per-app overrides). Implements `supports()` for `pagination` and `signals` (unlike Firebase).
- `src/__tests__/provider.test.ts` — mirror the provider-firebase contract tests with a fake fetch client (fixture `Response` objects). Aim for ~30 tests; reuse mapper tests against the recorded Sentry JSON shape (`fixtures/*.json`).
- `README.md` — how to create a Sentry auth token, required scopes (`event:read`, `project:read`).

After this ships:

- Add `Issue.state: "ignored"` to core types if Sentry needs it (currently `"open" | "closed" | "muted" | "unknown"` — `"muted"` covers it, but worth re-reading).
- Update `examples/single-app/config.yaml` with a Sentry variant.

### 2. `@crashwatch/tracker-github-issues`

With two providers alive the tracker interface can be validated cheaply. GitHub Issues is the simplest tracker to implement (`POST /repos/{owner}/{repo}/issues`), needs only a PAT with `repo` scope, and is exactly the kind of plugin a small team would actually use. Output ticket url should be persisted in the alert so a later CLI run can deduplicate.

### 3. Live BigQuery smoke

Only worth doing once a real Crashlytics export is available. Steps:
- `pnpm add -Dw @google-cloud/bigquery`
- Export a **read-only** GCP service account key to `GOOGLE_APPLICATION_CREDENTIALS`.
- Run `crashwatch check --config <real.yaml> --dry-run`. Compare SQL row shape vs `BqIssueRow` / `BqEventRow`.
- If the schema diverges, update mappers (_not_ the interfaces above).

### 4. Detector extensions

- **Resurfaced** kind: issue with `state=resolved` in history gains `recentEvents > 0`.
- **Prior-release baseline**: compare to same issue in the previous shipped `displayVersion`.
- Expose detector as pluggable (`config.detector: { plugin: ... }`).

### 5. Docs / release

- `docs/ROADMAP.md` (separate, maintained at project level; NEXT-SESSION.md is per-session working notes).
- Per-package READMEs for core, cli, notifier-webhook, notifier-slack (currently only provider-firebase has one).
- First `0.1.0-alpha.0` npm publish — dry-run with `pnpm -r publish --dry-run` first.

## Conventions worth remembering

- **Vendor names never in `core`.** If you touch `packages/core` and find yourself importing or even mentioning a product, stop — it belongs in a plugin.
- **Plugins default-export a factory.** `(options) => instance | Promise<instance>`. The CLI resolver also accepts `createPlugin` as a named export. Don't invent a third shape.
- **`as unknown as X` casts** are allowed at the BigQuery SDK boundary because the SDK's native return shape is wider than the subset we use. Prefer narrowing once at that seam over letting `unknown` leak.
- **Single-level globs in test scripts.** `src/__tests__/*.test.ts` expands under both bash (default) and zsh; `src/**/*.test.ts` needs `shopt -s globstar`, which CI doesn't enable.
- **Tests go under `src/__tests__/`.** Fixtures under `src/__tests__/fixtures/`. Build output stays out of VCS (`dist/` is gitignored).
- **Append-only state.** `JsonlSnapshotStore` never rewrites — compaction, if ever needed, is a new command (`crashwatch compact`), not an in-place edit.
- **Error messages are UI.** Failure modes that a user will see (missing config field, invalid table id) need a message that says what to fix.

## Suggested prompt for the next Claude Code session

```
crashwatch 프로젝트 `@crashwatch/provider-sentry` 구현을 이어서 진행해 줘.
리포는 ~/dev/personal/crashwatch (GitHub hx2ryu/crashwatch). 세부 컨텍스트는
레포 루트의 NEXT-SESSION.md를 먼저 읽고, "Next up" 1번 작업을 끝까지 가줘
— 소스 + 테스트 + README + CHANGELOG + CI 확인까지.
```

After that task is done, delete section "1." from the "Next up" list above and bump the "Current state" block so the next session picks up at section 2.
