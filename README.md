# crashwatch

> Vendor-neutral, plugin-based crash observability for mobile and backend apps.

crashwatch polls one or more crash-reporting backends (Firebase Crashlytics, Sentry, Bugsnag, BigQuery exports, your in-house endpoint, …), detects new / regressed / spiking issues against a rolling history, and dispatches alerts to the destination of your choice (Slack, webhook, PagerDuty, issue tracker, …). The core is intentionally small; every integration is a **plugin you opt into**.

**Status:** pre-alpha. API will change. Not yet published to npm.

## Why

Every crash-reporting vendor ships its own console. Organizations end up running multiple, and the useful signal — *"what changed since yesterday? who owns it? what is the known remediation?"* — lives between the tabs. crashwatch turns that question into a config file.

## Design principles

1. **Vendor-neutral core.** The core only knows about `Issue`, `CrashEvent`, `Snapshot`, `Alert`. Providers translate.
2. **Plugins are packages.** A plugin is a node module that default-exports a factory. Providers, notifiers, trackers all share this shape; writing a custom one takes ~30 lines.
3. **Config over code.** Adding an app is a YAML entry. Adding a channel is a YAML entry. Environment variables interpolate via `${VAR}` and `${VAR:-default}`.
4. **Inspectable state.** Default storage is append-only JSONL on disk. You can grep, diff, and commit it if you want.
5. **Small dependencies.** MVP core has one runtime dep (`yaml`). Providers only depend on their own SDKs.

## Architecture

```
                 ┌────────────────────────────────────┐
 schedule / loop │  CLI: crashwatch check             │
                 └───────┬────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Providers      Snapshot store   History
 (Crashlytics,      (JSONL / S3)   (last N runs)
   Sentry, …)           │              │
                        └──────┬───────┘
                               ▼
                          Detector
                 (new / spike / regression)
                               │
                               ▼
                           Notifiers
                  (Slack, webhook, email, …)
                               │
                               ▼
                          Trackers (opt.)
                   (Jira, Linear, GitHub, …)
```

## Packages (monorepo)

| Package | Purpose |
|---|---|
| [`@crashwatch/core`](./packages/core) | Types, config loader, detector, JSONL store, plugin interfaces |
| [`@crashwatch/cli`](./packages/cli) | `crashwatch init / validate / check` commands |
| [`@crashwatch/provider-firebase`](./packages/provider-firebase) | Firebase Crashlytics provider (BigQuery export + CLI modes) |
| [`@crashwatch/notifier-webhook`](./packages/notifier-webhook) | Generic HTTP webhook notifier |
| [`@crashwatch/notifier-slack`](./packages/notifier-slack) | Slack Incoming Webhook wrapper |

Planned:
- `@crashwatch/provider-sentry`, `@crashwatch/provider-bugsnag`, `@crashwatch/provider-bigquery`
- `@crashwatch/tracker-jira`, `@crashwatch/tracker-linear`, `@crashwatch/tracker-github`
- `@crashwatch/notifier-pagerduty`, `@crashwatch/notifier-email`

## Quick start

```bash
pnpm install
pnpm -r build

# scaffold a config
node packages/cli/bin/crashwatch.mjs init --config ./crashwatch.yaml

# edit crashwatch.yaml, then:
export SLACK_WEBHOOK_URL=...
node packages/cli/bin/crashwatch.mjs validate --config ./crashwatch.yaml

# dry run — prints alerts but does not send
node packages/cli/bin/crashwatch.mjs check --config ./crashwatch.yaml --dry-run

# live run, every hour (any cron works)
# 0 * * * * cd /srv/crashwatch && node packages/cli/bin/crashwatch.mjs check
```

See [`examples/single-app/config.yaml`](./examples/single-app/config.yaml) for a complete starter.

## Writing a plugin

```ts
// my-provider.ts
import type { ProviderFactory, CrashProvider, Issue, AppRef } from "@crashwatch/core";

const factory: ProviderFactory<{ apiKey: string }> = ({ apiKey }): CrashProvider => ({
  id: "my-provider",
  async listIssues(app: AppRef): Promise<Issue[]> {
    // ...call your API, map into core Issue shape...
    return [];
  },
  async getIssue() { /* ... */ throw new Error("not implemented"); },
  async listEvents() { return []; },
});

export default factory;
```

Reference from config:
```yaml
providers:
  - id: mine
    plugin: "./my-provider.js"   # relative to the config file
    options:
      apiKey: "${MY_API_KEY}"
```

## Documentation

- [Getting started](./docs/getting-started.md)
- [Configuration reference](./docs/configuration.md)
- [Writing a provider](./docs/writing-a-provider.md)
- [Writing a notifier](./docs/writing-a-notifier.md)
- [Playbooks for common crash categories](./docs/playbooks/README.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and small PRs are welcome; for larger changes please open a discussion first.

## License

[MIT](./LICENSE)
