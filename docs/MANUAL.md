# crashwatch — manual

Living reference for operators and plugin authors. If you're new, read top-to-bottom; if you're here for a specific task, skip to the section.

> **Status: `0.1.0-alpha.5` on npm.** Interfaces will change before 1.0. Don't pin without `@alpha`; don't ship to production without reading the [known limitations](#known-limitations).

---

## What crashwatch does

crashwatch is a small runner that:

1. **Polls** one or more crash-reporting backends (Firebase Crashlytics, Sentry, …) on a schedule you pick.
2. **Snapshots** each app's current state into a local append-only log.
3. **Detects** new / spiking / regressed / resurfaced issues by comparing the fresh snapshot against history.
4. **Dispatches** alerts to the destinations you configure (Slack, webhook, GitHub Issues, …).

The core has no vendor-specific code. Every integration is a plugin you opt into — providers translate backends into `Issue` / `CrashEvent`, notifiers and trackers send alerts downstream. Plugins are regular npm packages; writing a new one is ~30 lines.

## Why it exists

Every vendor ships its own console; teams end up running three or four. The useful question — *"what changed since yesterday, who owns it, what do we know about it?"* — lives between tabs. crashwatch turns that question into a config file and a cron entry.

---

## Concepts

| Term | What it is |
|---|---|
| **App** | A logical application (unique `name`) with per-platform `providerOptions`. |
| **Provider** | A plugin that adapts one backend into the core `CrashProvider` interface. |
| **Notifier** | A plugin that converts an `Alert` into a message on some channel. |
| **Tracker** | A plugin that creates / deduplicates issue-tracker tickets (GitHub, Jira, …). |
| **Detector** | A pure function `(current, history, thresholds) → Alert[]`. Replaceable via `config.detector`. |
| **Snapshot** | An immutable capture of an app's issue state at a single tick. Appended to JSONL. |
| **Alert** | A typed event emitted by the detector (`new_issue` / `spike` / `regression` / `resurfaced`). |
| **Store** | Where snapshots and alerts live. Default is `JsonlSnapshotStore` under `--state <dir>`. |

### Data flow

```
        ┌────────────────────── provider.listIssues ──────────────────────┐
        ▼                                                                 │
   ┌─────────┐   snapshot    ┌───────────┐                            ┌───┴────┐
   │ Sentry  │──────────────►│  Store    │◄──── history (last N) ─────┤ app    │
   │ Firebase│               │  (JSONL)  │                            │ config │
   │ …       │               └────┬──────┘                            └────────┘
   └─────────┘                    │
                                  ▼
                           ┌────────────┐
                           │  Detector  │   ┌── Notifiers (Slack, webhook, …)
                           │  (rules)   │───┤
                           └────────────┘   └── Trackers (GitHub Issues, …)
```

---

## Install

### Single-shot CLI use (recommended starting point)

```bash
pnpm add -D @hx2ryu/crashwatch-cli@alpha \
             @hx2ryu/crashwatch-provider-sentry@alpha \
             @hx2ryu/crashwatch-notifier-slack@alpha

# run the CLI from your project
pnpm exec crashwatch init --config ./crashwatch.yaml
```

### Global CLI

```bash
pnpm add -g @hx2ryu/crashwatch-cli@alpha
crashwatch --help
```

### Package combinations

| What you have | What to install |
|---|---|
| Firebase Crashlytics + Slack | `cli` + `provider-firebase` + `@google-cloud/bigquery` + `notifier-slack` |
| Sentry + Slack | `cli` + `provider-sentry` + `notifier-slack` |
| Either + webhook (PagerDuty, custom) | replace `notifier-slack` with `notifier-webhook` |
| + GitHub Issues on alerts | add `tracker-github-issues` |

Node ≥ 18 is required. Packages publish under the `alpha` dist-tag until 1.0.

---

## First run — end-to-end

Assume you have a Sentry project and a Slack Incoming Webhook URL.

**1. Create a working directory**

```bash
mkdir my-crashwatch && cd my-crashwatch
pnpm init -y
pnpm add -D @hx2ryu/crashwatch-cli@alpha \
             @hx2ryu/crashwatch-provider-sentry@alpha \
             @hx2ryu/crashwatch-notifier-slack@alpha
```

**2. Scaffold the config**

```bash
pnpm exec crashwatch init --config ./crashwatch.yaml
```

The generated file is a Firebase + webhook example; edit to look like this for Sentry + Slack:

```yaml
# crashwatch.yaml
version: 1

defaults:
  thresholds:
    regressionPct: 20
    newIssueEvents24h: 5
    regressionSignals: [SIGNAL_REGRESSED, SIGNAL_EARLY]

providers:
  - id: sentry
    plugin: "@hx2ryu/crashwatch-provider-sentry"
    options:
      authToken: "${SENTRY_AUTH_TOKEN}"
      org: "my-org"
      defaultProject: "web-frontend"
      defaultWindowHours: 24

notifiers:
  - id: slack
    plugin: "@hx2ryu/crashwatch-notifier-slack"
    options:
      webhookUrl: "${SLACK_WEBHOOK_URL}"

apps:
  - name: example-app
    platforms:
      android:
        providerOptions:
          project: "mobile-android"
          environment: "production"
      ios:
        providerOptions:
          project: "mobile-ios"
          environment: "production"
    providers: [sentry]
    notify: [slack]
```

**3. Provide credentials**

```bash
export SENTRY_AUTH_TOKEN="sntrys_..."
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

Sentry token scopes: `event:read`, `project:read`. See the [provider-sentry README](../packages/provider-sentry/README.md).

**4. Validate (cheap — no API calls)**

```bash
pnpm exec crashwatch validate --config ./crashwatch.yaml
```

Loads the config, resolves plugins, prints the resulting app / provider / notifier ids. Fails loudly on bad plugin paths or missing options.

**5. Dry run**

```bash
pnpm exec crashwatch check --config ./crashwatch.yaml --dry-run
```

Performs a full collection pass: Sentry is queried, a snapshot is written to `./.crashwatch/snapshots/example-app.jsonl`, but notifiers are NOT invoked. Alerts are printed to stdout.

**6. Live run**

```bash
pnpm exec crashwatch check --config ./crashwatch.yaml
```

Same as dry-run, but dispatches alerts to Slack. First run usually emits `new_issue` alerts for everything above `newIssueEvents24h` because there is no history yet; treat the first run as the baseline.

---

## Configuration reference

### Top-level

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `1` | ✓ | Schema version. |
| `defaults` | object | | Default `thresholds`, `dismissPatterns`, `notify` that each app inherits unless overridden. |
| `providers` | array | ✓ | At least one. |
| `notifiers` | array | | Empty array is valid — alerts are written to the store only. |
| `trackers` | array | | Optional. |
| `detector` | object | | Optional custom detector. Falls back to `defaultDetector`. |
| `apps` | array | ✓ | At least one. |

### Plugin references

`providers`, `notifiers`, and `trackers` share this shape:

```yaml
- id: <your-chosen-id>       # referenced by app.providers / app.notify / app.trackers
  plugin: <spec>             # npm specifier OR local path
  options: { ... }           # free-form; shape depends on the plugin
```

`plugin` resolution:
- Starts with `.` or `/` → resolved relative to the config file's directory.
- Otherwise → Node module resolution (`node_modules`).

`detector` has no `id` (at most one per config):

```yaml
detector:
  plugin: "./detectors/slo-burn.ts"   # or an npm package
  options: { ... }
```

### Environment variable interpolation

Every string value in the config is scanned for `${NAME}` and `${NAME:-fallback}`. Empty and unset variables collapse to `""` (or the fallback if provided). Use this for secrets — never commit credentials.

### App entry

```yaml
apps:
  - name: example-app                 # unique; appears in logs + file paths
    displayName: "Example App"        # optional; passed to notifiers as context
    owners: ["@team-mobile"]          # optional; passed as context
    platforms:                        # ≥ 1 platform required
      android:
        providerOptions:
          # shape depends on the provider
          project: "mobile-android"
      ios:
        providerOptions:
          project: "mobile-ios"
    providers: [sentry]               # subset of top-level providers; omit to use all
    notify: [slack]                   # subset of top-level notifiers
    trackers: [gh-issues]             # subset of top-level trackers
    thresholds:                       # overrides defaults
      regressionPct: 50
    dismissPatterns:                  # regex list; matching issue titles are skipped
      - "^ThirdParty SDK - "
```

### Thresholds

| Field | Default | Meaning |
|---|---|---|
| `regressionPct` | `20` | Percent increase over baseline that counts as a `spike`. |
| `newIssueEvents24h` | `5` | Minimum 24-h events for `new_issue` to fire. |
| `regressionSignals` | `[SIGNAL_REGRESSED, SIGNAL_EARLY]` | Provider-emitted signals that trigger `regression`. |

Formal schema: [`schemas/config.schema.json`](../schemas/config.schema.json). Add `# yaml-language-server: $schema=./schemas/config.schema.json` to the top of your config for editor autocomplete.

---

## CLI reference

Binary: `crashwatch` (from `@hx2ryu/crashwatch-cli`).

### `crashwatch init`

Writes a starter config. Refuses to overwrite an existing file.

```bash
crashwatch init --config ./crashwatch.yaml
```

### `crashwatch validate`

Loads the config and resolves every plugin reference via `import()`. No external calls. Useful in CI to catch bad plugin paths or missing options.

```bash
crashwatch validate --config ./crashwatch.yaml
crashwatch validate --config ./crashwatch.yaml --json
```

### `crashwatch check`

The main runner. For every app × platform × provider:

1. `provider.listIssues` over the last 24 h (or `defaults.window`).
2. Fills in `recentEvents` via `listEvents` only if the provider didn't attach them.
3. Appends a `Snapshot` to `<state>/snapshots/<app>.jsonl`.
4. Reads the last 50 snapshots as history.
5. Runs the detector; returns zero or more `Alert`s.
6. Dispatches each alert to the notifiers configured for the app; appends the alert to `<state>/alerts/<app>.jsonl`.

```bash
crashwatch check --config ./crashwatch.yaml
crashwatch check --config ./crashwatch.yaml --state ./.crashwatch --dry-run
crashwatch check --config ./crashwatch.yaml --json
```

### Options

| Flag | Default | Purpose |
|---|---|---|
| `-c`, `--config <path>` | `./crashwatch.yaml` | Config file path (YAML or JSON). |
| `--state <dir>` | `./.crashwatch` | Where snapshots and alerts are written. |
| `--dry-run` | off | Run detection; do not invoke notifiers. Still writes the snapshot. |
| `--json` | off | Emit machine-readable JSON on commands that support it. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Command completed. In `check`, notifier errors are logged to stderr but do NOT flip the exit code — one bad destination shouldn't block detection on others. |
| `1` | Unhandled error (bad config, plugin load failure, detector crash, `init` refusing to overwrite). |
| `2` | Unknown subcommand. |

---

## Built-in providers

### `@hx2ryu/crashwatch-provider-firebase`

Reads the Firebase Crashlytics → **BigQuery export**. Firebase has no stable public REST API for listing issues, so the export is the only supported backend.

Requires `@google-cloud/bigquery` as a peer dep and a per-app `bigqueryTable` fully-qualified identifier. No `pagination` or `signals` capability (BigQuery export doesn't carry `SIGNAL_REGRESSED`). See the [package README](../packages/provider-firebase/README.md) for IAM roles, cost notes, and schema.

### `@hx2ryu/crashwatch-provider-sentry`

Talks to `https://sentry.io/api/0/...` via pure `fetch`. No runtime deps.

Advertises `pagination` (cursor-based via the `Link` header) and `signals` (`isRegressed` → `SIGNAL_REGRESSED`, newly-seen issues → `SIGNAL_EARLY`), so the default detector alerts on regressions directly without needing a 7-day snapshot history.

Status mapping: `unresolved → open`, `resolved → closed`, `ignored → muted`, `reprocessing → unknown`. See the [package README](../packages/provider-sentry/README.md).

---

## Built-in notifiers

### `@hx2ryu/crashwatch-notifier-webhook`

Generic `POST <url>` with a JSON body. Two body templates:

- `raw` (default) — the `Alert` object, plus `context` from `NotifyContext`.
- `slack-incoming-webhook` — Slack's [Block Kit](https://api.slack.com/block-kit) flavour; works against Slack's Incoming Webhook URL.

### `@hx2ryu/crashwatch-notifier-slack`

Thin convenience wrapper over `notifier-webhook` that pre-selects the Slack template. Takes `webhookUrl` and an optional cosmetic `channel`.

---

## Built-in trackers

### `@hx2ryu/crashwatch-tracker-github-issues`

`POST https://api.github.com/repos/{owner}/{repo}/issues`. Requires a PAT (classic) or fine-grained token with `repo` scope.

Returns the created issue's `html_url` which crashwatch persists on the alert — subsequent runs can dedupe by checking prior alerts' tracker records (not yet automatic; see [ROADMAP](./ROADMAP.md)).

Per-alert `owner`, `repo`, `labels`, `assignees` override tracker-level defaults (they **replace**, not merge).

---

## Built-in detector rules

`defaultDetector` emits four alert kinds, per issue per tick:

1. **`new_issue`** — issue id not seen in any historical snapshot AND `recentEvents >= thresholds.newIssueEvents24h`.
2. **`spike`** — `recentEvents` grew by `≥ thresholds.regressionPct` vs a baseline. Two baseline sources are considered:
   - **`week_over_week`** — same-weekday snapshot from history (±12h window).
   - **`prior_release`** — the most recent history snapshot whose `lastSeenVersion` was strictly older (semver-aware comparator).

   If both fire, only the larger-delta alert is emitted. `baselineSource` is attached to the alert context.
3. **`regression`** — issue carries any signal listed in `thresholds.regressionSignals`.
4. **`resurfaced`** — a historical snapshot showed the issue as `closed`, and the current window has events. Suppressed when `regression` also qualifies.

Precedence: `regression` > `resurfaced`; `new_issue` short-circuits `spike` on brand-new ids.

Version comparison: `"1.10.0" > "1.2.0"` via an inline semver parser. Unparseable strings (commit SHAs, etc.) fall back to plain string compare. Exported as `compareVersions(a, b)` from `@hx2ryu/crashwatch-core`.

### Replacing the default detector

```yaml
detector:
  plugin: "./my-detector.ts"
  options: { ... }
```

```ts
// my-detector.ts
import type { Detector, DetectorFactory } from "@hx2ryu/crashwatch-core";

const factory: DetectorFactory<{ budgetSec?: number }> = ({ budgetSec }) => {
  const detector: Detector = (current, history, thresholds) => {
    // compute alerts; see packages/core/src/detector.ts for reference
    return [];
  };
  return detector;
};

export default factory;
```

---

## Scheduling & state

### Scheduling

crashwatch is **stateless between runs** — everything it needs is in `--state`. Any scheduler works:

- **cron**: `0 * * * * cd /srv/crashwatch && crashwatch check --config /etc/crashwatch.yaml`
- **systemd timer**: standard OnCalendar + Unit pair
- **Kubernetes `CronJob`**: mount `--state` on a PVC
- **GitHub Actions** `schedule:` trigger: commit the state dir to a branch or push to S3

### State layout

```
<state>/
  snapshots/<app>.jsonl     # one JSON Snapshot per line, appended
  alerts/<app>.jsonl        # one JSON Alert per line, appended
```

The JSONL files are never rewritten. Compaction, if ever needed, is a separate command (not yet implemented). Grep, diff, commit them if you want.

### Retention

The runner reads the last 50 snapshots per app. Truncating older entries is safe. Anything past ~14 days is not consulted by `defaultDetector`.

---

## Operations & troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Plugin "X" must default-export … a factory function.` | Plugin path wrong, or plugin doesn't default-export a factory. | Check the `plugin:` spec; confirm the package's `main` points at compiled JS that default-exports a factory. |
| `App "…" is missing providerOptions.project` | Sentry provider without per-app or default project. | Add `project:` under the app's `platforms.<platform>.providerOptions`, or set `defaultProject` at the provider level. |
| First run fires `new_issue` for every issue | Expected. History is empty on the first tick. | Run once with `--dry-run` to seed history; subsequent runs compare against it. |
| Sentry returns 401 | `SENTRY_AUTH_TOKEN` unset, or scopes insufficient. | Token needs `event:read`, `project:read`. |
| BigQuery bill spike | Missing time partition in a query. | Always pass `from`/`to`; the default 24-h window is applied by the runner. |
| Alerts not reaching Slack | `SLACK_WEBHOOK_URL` empty or revoked. | Run `crashwatch check --dry-run` — if alerts show in stdout, the detector is fine; fix the webhook URL. |
| Provenance badge missing on npmjs | Package was published before the repo went public, or from outside GH Actions. | Re-publish a patch version via the CI workflow. |

### Verifying published provenance

```bash
cd /some/project-using-crashwatch
npm audit signatures
```

Every `@hx2ryu/crashwatch-*@0.1.0-alpha.5` tarball carries a SLSA v1 provenance attestation signed by GitHub Actions OIDC.

---

## Extending

- **New provider** — see [`docs/writing-a-provider.md`](./writing-a-provider.md). Real examples: [`provider-sentry`](../packages/provider-sentry) (REST + pagination), [`provider-firebase`](../packages/provider-firebase) (BigQuery).
- **New notifier** — see [`docs/writing-a-notifier.md`](./writing-a-notifier.md). Real example: [`notifier-webhook`](../packages/notifier-webhook).
- **New tracker** — mirror `tracker-github-issues`; interface is `IssueTracker` from core.
- **Custom detector** — see "Replacing the default detector" above.

A plugin is a regular npm package. If it's only for your team, publish to a private registry or install from a git URL.

---

## Upgrading

All packages ship under the `alpha` dist-tag until 1.0. To update:

```bash
pnpm up '@hx2ryu/crashwatch-*@alpha' --latest
```

Or pin to a specific version if a breaking change lands in an alpha bump.

### Stale tags

`0.1.0-alpha.1` through `0.1.0-alpha.4` exist as git tags in the repo but never reached npm — they were failed OIDC-publishing experiments. The published versions are `0.1.0-alpha.0` and `0.1.0-alpha.5`. Both are functionally identical; `latest` and `alpha` both resolve to `0.1.0-alpha.5`.

---

## Known limitations

- **Pre-alpha.** `CrashProvider`, `Notifier`, `IssueTracker`, and `Detector` interfaces will shift before 1.0. Follow the CHANGELOG.
- **No live smoke tests.** Mappers are validated against recorded fixtures, not against real Crashlytics / Sentry / GitHub traffic yet. A schema change in any of those upstreams could surface as a runtime shape error before the fixtures catch up.
- **Detector state window** is 50 snapshots. Beyond that the `new_issue` rule may refire after long quiet periods.
- **Tracker dedup is not automatic.** The tracker plugin persists `html_url` onto alerts, but the runner doesn't yet consult prior alerts to avoid opening duplicates.
- **npm Trusted Publishing is on hold** for this project — pnpm + the GH-runner npm don't exchange OIDC claims for a publish token yet, so releases still go through a scoped `NPM_TOKEN` secret. See [`docs/release.md`](./release.md) and `NEXT-SESSION.md`.

---

## See also

- [`README.md`](../README.md) — project pitch and architecture diagram
- [`docs/getting-started.md`](./getting-started.md) — shorter quick-start path
- [`docs/configuration.md`](./configuration.md) — config reference (this manual supersedes it)
- [`docs/release.md`](./release.md) — how to cut a release
- [`docs/ROADMAP.md`](./ROADMAP.md) — public roadmap
- [`docs/writing-a-provider.md`](./writing-a-provider.md) / [`docs/writing-a-notifier.md`](./writing-a-notifier.md) — plugin-author guides
- [`docs/playbooks/`](./playbooks/) — runbooks for common crash categories (stubs)
- Per-package READMEs under [`packages/*/README.md`](../packages)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) / [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md)
