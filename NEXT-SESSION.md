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

If a new machine or clone: replicate these three, then `corepack enable && pnpm install && pnpm -r build && pnpm test`. All 182 tests should be green.

## Current state (as of 2026-04-19)

**What works end-to-end:**
- `crashwatch init / validate / check` CLI loads a YAML/JSON config, resolves plugins via `import()`, writes JSONL snapshots + alerts, dispatches notifiers.
- `@crashwatch/provider-firebase` implements `listIssues / getIssue / listEvents / getReport` against the Crashlytics BigQuery export (lazy-loads `@google-cloud/bigquery`).
- `@crashwatch/provider-sentry` implements `listIssues / getIssue / listEvents` against the public Sentry REST API with cursor pagination + 429/503 backoff. Advertises `pagination` and `signals` capabilities (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`). No extra deps — pure `fetch`.
- `@crashwatch/tracker-github-issues` implements `IssueTracker` via GitHub REST API (`POST /repos/{owner}/{repo}/issues`). Pure `fetch`, jittered backoff on 429/502/503, clear 401/403 messages. Returns the created issue's `html_url` so the runner can persist it on the alert for dedup. Per-alert owner/repo/labels/assignees override tracker defaults.
- `@crashwatch/notifier-webhook` + `@crashwatch/notifier-slack` deliver alerts to a URL.
- `defaultDetector` emits `new_issue / spike / regression / resurfaced` using provider-supplied counts and signals. Spike path supports two baselines: same-weekday (`baselineSource: "week_over_week"`) and prior-release (`baselineSource: "prior_release"`). When both fire, only the larger-delta alert is emitted.
- Detector is now **pluggable via config**. `config.detector: { plugin, options? }` replaces `defaultDetector` wholesale. CLI resolves it the same way provider/notifier/tracker plugins are resolved. `DetectorFactory` exported from `@crashwatch/core`.
- Per-package READMEs now exist for every package; `docs/ROADMAP.md` is the public roadmap (NEXT-SESSION.md is internal session notes).
- 182 tests across 7 packages; GitHub Actions runs `pnpm install / -r build / typecheck / test` on every push + PR and is currently green.

**What is deferred and why:**
- No live BigQuery / Sentry / GitHub smoke test yet — depends on real credentials.
- Two providers alive now; the `CrashProvider` interface has been pressure-tested against Sentry's shape (pagination, signals) but has not yet seen Bugsnag / Rollbar.
- Detector version comparison is string-wise; semver-aware comparison is a future nice-to-have.
- Nothing is on npm yet. First publish awaits an audit of `package.json` `files`, `main`, `types`, `engines` across all packages.

**Last commits on main:** see `git log`. Recent feature work:
`feat(core+cli): pluggable detector via config.detector` →
`docs: CHANGELOG + NEXT-SESSION after parallel stream merge` →
`docs: per-package READMEs + public ROADMAP` →
`feat(core/detector): resurfaced + prior-release baseline` →
`feat(tracker-github-issues): GitHub Issues tracker plugin` →
`feat(provider-sentry): Sentry REST API provider`.

## Next up (priority order)

### 1. Release prep — first `0.1.0-alpha.0` npm publish

Everything the alpha needs is in the tree. Ship it.

- Audit each package's `package.json` `files`, `main`, `types`, `engines`, `license`, `repository`, and `publishConfig` (public access needed).
- Run `pnpm -r publish --dry-run` and eyeball each package's tarball contents — no dist leaks, no accidental source-map stripping, no secrets.
- Decide on whether `@crashwatch/*` is to be a public npm org or if each package publishes unscoped (org gives namespace control).
- Tag and publish once dry-run is clean: `pnpm -r publish --access public`.

### 2. Live BigQuery / Sentry / GitHub smoke

Only worth doing once real credentials exist. For BigQuery:
- `pnpm add -Dw @google-cloud/bigquery`
- Export a **read-only** GCP service account key to `GOOGLE_APPLICATION_CREDENTIALS`.
- Run `crashwatch check --config <real.yaml> --dry-run`. Compare SQL row shape vs `BqIssueRow` / `BqEventRow`.

For Sentry:
- Export `SENTRY_AUTH_TOKEN` (scopes `event:read`, `project:read`).
- Point `examples/single-app/config.yaml` at a real org/project, run `crashwatch check --dry-run`.
- Verify `SentryIssue` / `SentryEvent` fixtures still reflect the live schema.

For GitHub tracker:
- PAT with `repo` scope, run `check` against a throwaway repo, confirm the tracker returns a real `html_url` and the alert records it.

### 3. Detector: semver-aware version comparison

Prior-release baseline currently uses plain string `<`. Upgrade to parse major/minor/patch so `"1.10.0" > "1.2.0"` is handled correctly. Add a tiny hand-rolled comparator in `packages/core/src/detector.ts` (avoid pulling in a semver dep unless more than one feature needs it).

### 4. CI chore — Node.js 20 deprecation

GitHub's runner deprecates Node 20 on 2026-09-16. `actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4` will need to be bumped to a Node-24-compatible release. Tracked as its own small PR.

## Conventions worth remembering

- **Vendor names never in `core`.** If you touch `packages/core` and find yourself importing or even mentioning a product, stop — it belongs in a plugin.
- **Plugins default-export a factory.** `(options) => instance | Promise<instance>`. The CLI resolver also accepts `createPlugin` as a named export. Don't invent a third shape.
- **`as unknown as X` casts** are allowed at the BigQuery SDK boundary because the SDK's native return shape is wider than the subset we use. Prefer narrowing once at that seam over letting `unknown` leak.
- **`fetch` is the Sentry boundary.** The Sentry provider has no HTTP client dependency — it uses Node's built-in `fetch` and injects it for tests. Do not add `undici`/`axios` unless there is a concrete need that native `fetch` can't meet.
- **Single-level globs in test scripts.** `src/__tests__/*.test.ts` expands under both bash (default) and zsh; `src/**/*.test.ts` needs `shopt -s globstar`, which CI doesn't enable.
- **Tests go under `src/__tests__/`.** Fixtures under `src/__tests__/fixtures/`. Build output stays out of VCS (`dist/` is gitignored).
- **Append-only state.** `JsonlSnapshotStore` never rewrites — compaction, if ever needed, is a new command (`crashwatch compact`), not an in-place edit.
- **Error messages are UI.** Failure modes that a user will see (missing config field, invalid table id) need a message that says what to fix.

## Suggested prompt for the next Claude Code session

```
crashwatch 프로젝트 첫 알파 npm publish 준비를 이어서 진행해 줘.
리포는 ~/dev/personal/crashwatch (GitHub hx2ryu/crashwatch). 세부 컨텍스트는
레포 루트의 NEXT-SESSION.md를 먼저 읽고, "Next up" 1번 작업을 끝까지 가줘
— package.json 감사 + pnpm -r publish --dry-run + CHANGELOG + CI 확인까지.
```

After that task is done, delete section "1." from the "Next up" list above and bump the "Current state" block so the next session picks up at section 2.
