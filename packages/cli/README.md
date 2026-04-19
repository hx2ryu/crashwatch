# @crashwatch/cli

Command-line runner for [crashwatch](../../README.md). Loads a YAML/JSON config, resolves plugins via dynamic `import()`, snapshots each app, runs the detector, and dispatches alerts.

## Install

```bash
# global
pnpm add -g @crashwatch/cli

# or local to a repo
pnpm add -D @crashwatch/cli
```

From inside the monorepo you can also run the bin directly without installing:

```bash
node packages/cli/bin/crashwatch.mjs <command> [options]
```

Requires Node ≥ 18.

## Commands

### `crashwatch init`

Scaffold a starter config. Writes to the path given by `--config` (default `./crashwatch.yaml`). Refuses to overwrite if the file already exists.

```bash
crashwatch init --config ./crashwatch.yaml
```

### `crashwatch validate`

Load the config and resolve all plugin references (providers, notifiers, trackers) via `import()` without actually running a collection. Useful for catching bad plugin paths, missing options, and schema errors in CI.

```bash
crashwatch validate --config ./crashwatch.yaml
crashwatch validate --config ./crashwatch.yaml --json
```

### `crashwatch check`

The main runner. For every app × platform × provider combination in the config:

1. Calls `provider.listIssues` over the last 24 h (and fills in `recentEvents` counts via `listEvents` only if the provider did not attach them).
2. Appends the resulting `Snapshot` to the JSONL store.
3. Reads the last 50 snapshots for that app as history.
4. Runs `defaultDetector` to produce zero or more `Alert`s.
5. Dispatches each alert to every notifier that applies to the app, and appends the alert to the JSONL store.

```bash
crashwatch check --config ./crashwatch.yaml
crashwatch check --config ./crashwatch.yaml --state ./.crashwatch --dry-run
crashwatch check --config ./crashwatch.yaml --json
```

## Options

| Flag | Default | Purpose |
|---|---|---|
| `-c, --config <path>` | `./crashwatch.yaml` | Path to the config file (YAML or JSON). |
| `--state <dir>` | `./.crashwatch` | Directory the `JsonlSnapshotStore` reads from and writes to. Snapshots go to `<state>/snapshots/<app>.jsonl`, alerts to `<state>/alerts/<app>.jsonl`. |
| `--dry-run` | off | Run detection but do not call any notifier. Prints the alerts it would have sent to stdout; still writes the snapshot to the store. |
| `--json` | off | Emit machine-readable JSON on commands that support it (`validate`, `check` in dry-run). |

All flags are accepted by every command, but `--dry-run` and `--json` are most useful on `check`.

## Example

```bash
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
export SENTRY_AUTH_TOKEN=sntrys_...

crashwatch validate --config ./crashwatch.yaml
crashwatch check    --config ./crashwatch.yaml --dry-run
crashwatch check    --config ./crashwatch.yaml
```

A typical deployment wires the last line into cron, systemd timer, or CI:

```cron
0 * * * * cd /srv/crashwatch && crashwatch check --config ./crashwatch.yaml
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Command completed successfully. In `check`, notifier errors are logged to stderr but do not flip the exit code — detection of other alerts is not blocked by one bad destination. |
| `1` | An unhandled error bubbled up (bad config, plugin load failure, detector crash, `init` refusing to overwrite an existing file). |
| `2` | Unknown subcommand. |

## Development

```bash
pnpm --filter @crashwatch/cli test
pnpm --filter @crashwatch/cli build
```

The test suite is an end-to-end `check` smoke run against fixture provider and notifier plugins loaded through the real plugin resolver.
