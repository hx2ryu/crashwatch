# Next session — resuming crashwatch

> Living document. Update the "Current state" block at the end of each
> session and edit "Next up" as tasks complete. Delete when the repo goes
> public / first 1.0 ships.

## Context for a fresh Claude / engineer

crashwatch is a pre-alpha, vendor-neutral crash observability monorepo. Core knows nothing about any specific backend; providers (`@hx2ryu/crashwatch-provider-*`), notifiers (`@hx2ryu/crashwatch-notifier-*`), trackers (`@hx2ryu/crashwatch-tracker-*`) are plugins loaded by id. Design rationale in the root [README](./README.md), short version: **the core must never acquire a dependency on a specific vendor**; if a PR tempts you that way, split it into a plugin.

Repo is **private**, owned by `hx2ryu` on GitHub: https://github.com/hx2ryu/crashwatch. Local clone at `~/dev/personal/crashwatch`. License MIT.

Stack: **Node ≥ 18**, **TypeScript 5.5+**, **pnpm 9** (workspaces), **tsx + `node --test`** for tests.

## Environment expectations

All three identity layers are already configured on this machine:

- **Git commit author** — `~/.gitconfig` has `[includeIf "gitdir:~/dev/personal/"]` → `~/.gitconfig-personal` (`hx2ryu / 58078994+hx2ryu@users.noreply.github.com`).
- **gh CLI** — `~/dev/personal/.envrc` pins `GH_TOKEN` to the hx2ryu token via `direnv`. Allow with `direnv allow` on first entry.
- **Git SSH** — `~/.ssh/config` has `Host github.com-hx2ryu` → `~/.ssh/hx2ryu`. The repo remote is `git@github.com-hx2ryu:hx2ryu/crashwatch.git`.

If a new machine or clone: replicate these three, then `corepack enable && pnpm install && pnpm -r build && pnpm test`. All 191 tests should be green.

## Current state (as of 2026-04-19)

**What works end-to-end:**
- `crashwatch init / validate / check` CLI loads a YAML/JSON config, resolves plugins via `import()`, writes JSONL snapshots + alerts, dispatches notifiers.
- `@hx2ryu/crashwatch-provider-firebase` implements `listIssues / getIssue / listEvents / getReport` against the Crashlytics BigQuery export (lazy-loads `@google-cloud/bigquery`).
- `@hx2ryu/crashwatch-provider-sentry` implements `listIssues / getIssue / listEvents` against the public Sentry REST API with cursor pagination + 429/503 backoff. Advertises `pagination` and `signals` capabilities (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`). No extra deps — pure `fetch`.
- `@hx2ryu/crashwatch-tracker-github-issues` implements `IssueTracker` via GitHub REST API (`POST /repos/{owner}/{repo}/issues`). Pure `fetch`, jittered backoff on 429/502/503, clear 401/403 messages. Returns the created issue's `html_url` so the runner can persist it on the alert for dedup. Per-alert owner/repo/labels/assignees override tracker defaults.
- `@hx2ryu/crashwatch-notifier-webhook` + `@hx2ryu/crashwatch-notifier-slack` deliver alerts to a URL.
- `defaultDetector` emits `new_issue / spike / regression / resurfaced` using provider-supplied counts and signals. Spike path supports two baselines: same-weekday (`baselineSource: "week_over_week"`) and prior-release (`baselineSource: "prior_release"`). When both fire, only the larger-delta alert is emitted.
- Detector is now **pluggable via config**. `config.detector: { plugin, options? }` replaces `defaultDetector` wholesale. CLI resolves it the same way provider/notifier/tracker plugins are resolved. `DetectorFactory` exported from `@hx2ryu/crashwatch-core`.
- Per-package READMEs now exist for every package; `docs/ROADMAP.md` is the public roadmap (NEXT-SESSION.md is internal session notes).
- Detector version comparison is semver-aware (`1.10.0 > 1.2.0`); `compareVersions` is exported from `@hx2ryu/crashwatch-core` for reuse in custom detectors.
- All 7 publishable packages carry full npm metadata (`publishConfig.access: "public"`, `repository.directory`, `homepage`, `bugs`, `keywords`, `files` excluding compiled tests). `pnpm -r publish --dry-run --access public` is clean; tarballs 2.7 kB–18.8 kB each, no test leakage, `workspace:*` → `0.1.0-alpha.0` rewrite confirmed.
- CI runs on `actions/checkout@v6` + `actions/setup-node@v6` (Node 22 LTS) + `pnpm/action-setup@v5` — silencing the Node 20 deprecation warning ahead of GitHub's 2026-09-16 removal.
- 191 tests across 7 packages; GitHub Actions runs `pnpm install / -r build / typecheck / test` on every push + PR and is currently green.

**What is deferred and why:**
- No live BigQuery / Sentry / GitHub smoke test yet — depends on real credentials.
- Two providers alive now; the `CrashProvider` interface has been pressure-tested against Sentry's shape (pagination, signals) but has not yet seen Bugsnag / Rollbar.
- **0.1.0-alpha.0 SHIPPED** on 2026-04-21: all 7 packages on npm under `@hx2ryu/crashwatch-*` (dist-tag `alpha`), each with SLSA v1 provenance signed by GitHub Actions OIDC. First alpha released via `.github/workflows/release.yml` + a 1-day granular token.

**Last commits on main:** see `git log`. Recent feature work:
`chore(release): prep 0.1.0-alpha.0 publish dry-run` →
`feat(core/detector): semver-aware version comparison` →
`ci: bump actions to v5/v6 and Node 22` →
`feat(core+cli): pluggable detector via config.detector` →
`docs: per-package READMEs + public ROADMAP` →
`feat(core/detector): resurfaced + prior-release baseline` →
`feat(tracker-github-issues): GitHub Issues tracker plugin` →
`feat(provider-sentry): Sentry REST API provider`.

## Next up (priority order)

### 1. Finish the migration to OIDC Trusted Publishing

**Status on 2026-04-22**: Trusted Publishers are configured on all 7 packages; `id-token: write` + `ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN}` are confirmed present in the workflow env. The OIDC-only path fails end-to-end because neither pnpm 10.33's `publish` nor the Node-22-bundled npm 10.9.7 perform the OIDC → npm token exchange — PUT goes out unauthenticated, registry returns 404. The release workflow is on `NPM_TOKEN` + "Bypass 2FA" again.

Try again when ONE of the following is true:

- **pnpm** ships an OIDC-capable `publish` (track: https://github.com/pnpm/pnpm/issues mentioning "trusted publishing" / "OIDC"). Also try `pnpm dlx npm@latest publish <tarball>` as an intermediate path.
- **npm** bundled with GH runner's Node image catches up to ≥ 11.5.1 (Node 22 LTS ships with 10.x; Node 24 likely brings ≥ 11). Workflow then switches to `pnpm pack` → `for tgz in *.tgz; do npm publish "$tgz" ...; done`, using pnpm for workspace:* rewrite and npm for OIDC auth.
- A supported `actions/setup-node` flag or separate action (e.g. an npm-flavored `actions/attest-publish`) lands that explicitly handles Trusted Publishing. Search for maintained GH Actions in the marketplace tagged with "npm oidc".

When ready to migrate: drop `env: NODE_AUTH_TOKEN` from `.github/workflows/release.yml`, delete the `NPM_TOKEN` repo secret, revoke the remaining granular token on npm, cut a throwaway `0.1.0-alpha.N+1` to verify, then call it done.

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

### 3. Post-alpha: second-provider interface review

With the alpha out in the wild, take another pass over the `CrashProvider` contract before 0.1.0 (non-alpha). Pressure-test against Bugsnag / Rollbar docs — do they expose something the current types can't represent (e.g. per-event breadcrumbs in a shape we can't map, or project hierarchies)? If YES, either extend the interface or file it as a 0.2 concern.

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
crashwatch 프로젝트 npm Trusted Publishing 전환 작업을 이어서 진행해 줘.
리포는 ~/dev/personal/crashwatch (GitHub hx2ryu/crashwatch). 세부 컨텍스트는
레포 루트의 NEXT-SESSION.md "Next up" 1번 작업을 먼저 읽어 줘.
7개 패키지 각각 Trusted Publisher 등록 안내 + workflow에서 NPM_TOKEN 제거
+ throwaway 0.1.0-alpha.1 release로 OIDC-only publish 검증까지.
```

After that task is done, delete section "1." from the "Next up" list above and bump the "Current state" block so the next session picks up at section 2.
