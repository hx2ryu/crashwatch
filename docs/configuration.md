# Configuration reference

The configuration file is YAML (JSON also accepted). It has four top-level keys: `providers`, `notifiers`, `apps`, and an optional `trackers`. `defaults` applies to every app unless overridden.

See [`../schemas/config.schema.json`](../schemas/config.schema.json) for the formal schema (most editors pick this up automatically if you add `# yaml-language-server: $schema=...` at the top of your config).

## Top-level

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | `1` | ✓ | Schema version. |
| `defaults` | object | | Default thresholds / dismiss patterns applied to every app. |
| `providers` | array | ✓ | Crash-reporting backends to query. |
| `notifiers` | array | | Destinations for alerts. Empty is valid (dry-only). |
| `trackers` | array | | Optional issue-tracker integrations. |
| `apps` | array | ✓ | One entry per logical app. |

## Plugin references

`providers`, `notifiers`, and `trackers` share a shape:

```yaml
- id: my-slack            # referenced from apps below
  plugin: "@hx2ryu/crashwatch-notifier-slack"  # module specifier or relative path
  options:                # free-form; shape depends on the plugin
    webhookUrl: "${SLACK_WEBHOOK_URL}"
```

`plugin` is resolved via `import()`:
- Starts with `.` or is absolute → resolved against the **config file's directory**
- Otherwise → resolved through Node's module resolution (npm package name)

A plugin must `export default` a factory function that receives `options` and returns the plugin instance.

## Environment variable interpolation

Any string containing `${NAME}` is replaced with `process.env.NAME`. `${NAME:-fallback}` uses `fallback` if the variable is unset or empty.

## App entry

```yaml
apps:
  - name: example-app               # unique, used in logs and file paths
    displayName: "Example App"      # optional, free text
    owners: ["@you"]                # optional, passed to notifiers as context
    platforms:
      android:
        providerOptions:
          # shape depends on the provider
          appId: "1:...:android:..."
      ios:
        providerOptions:
          appId: "1:...:ios:..."
    providers: [firebase]           # subset of top-level providers; omit to use all
    notify: [my-slack]              # subset of top-level notifiers
    thresholds:                     # override defaults if needed
      regressionPct: 50
```

## Thresholds

| Field | Default | Meaning |
|---|---|---|
| `regressionPct` | `20` | Percent increase vs same-weekday baseline that counts as a spike. |
| `newIssueEvents24h` | `5` | Minimum 24-hour events for a new issue to alert. |
| `regressionSignals` | `[SIGNAL_REGRESSED, SIGNAL_EARLY]` | Provider signals that always alert. |

## Storage

Snapshots land in `--state <dir>` (default `./.crashwatch`):

```
.crashwatch/
  snapshots/<app>.jsonl
  alerts/<app>.jsonl
```

You can change the storage backend by implementing `SnapshotStore` and passing your own instance from a custom runner.
