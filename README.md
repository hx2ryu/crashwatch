# crashwatch

> Vendor-neutral, plugin-based crash observability for mobile and backend apps.

crashwatch polls one or more crash-reporting backends (Firebase Crashlytics, Sentry, …), detects new / regressed / spiking / resurfaced issues against a rolling history, and dispatches alerts to the destination of your choice (Slack, webhook, GitHub Issues, …). The core is intentionally small; every integration is a **plugin you opt into**.

**Status:** pre-alpha, `0.1.0-alpha.5` live on npm under `@hx2ryu/crashwatch-*`. Interfaces will shift before 1.0. For usage start with [`docs/MANUAL.md`](./docs/MANUAL.md).

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

## Packages

Seven packages ship on npm at `0.1.0-alpha.5`, all under the `@alpha` dist-tag:

| Package | Purpose |
|---|---|
| [`@hx2ryu/crashwatch-core`](./packages/core) | Types, config loader, detector, JSONL store, plugin interfaces |
| [`@hx2ryu/crashwatch-cli`](./packages/cli) | `crashwatch init / validate / check` commands |
| [`@hx2ryu/crashwatch-provider-firebase`](./packages/provider-firebase) | Firebase Crashlytics provider (BigQuery export) |
| [`@hx2ryu/crashwatch-provider-sentry`](./packages/provider-sentry) | Sentry provider (public REST API) |
| [`@hx2ryu/crashwatch-notifier-webhook`](./packages/notifier-webhook) | Generic HTTP webhook notifier |
| [`@hx2ryu/crashwatch-notifier-slack`](./packages/notifier-slack) | Slack Incoming Webhook convenience wrapper |
| [`@hx2ryu/crashwatch-tracker-github-issues`](./packages/tracker-github-issues) | GitHub Issues tracker |

Candidates tracked in [`docs/ROADMAP.md`](./docs/ROADMAP.md): Bugsnag / Rollbar providers, Jira / Linear trackers, PagerDuty / email notifiers. Nothing committed — a new provider ships when an end user wants to help.

## Quick start

```bash
mkdir my-crashwatch && cd my-crashwatch
pnpm init -y
pnpm add -D @hx2ryu/crashwatch-cli@alpha \
             @hx2ryu/crashwatch-provider-sentry@alpha \
             @hx2ryu/crashwatch-notifier-slack@alpha

pnpm exec crashwatch init --config ./crashwatch.yaml
# edit crashwatch.yaml

export SENTRY_AUTH_TOKEN=sntrys_...
export SLACK_WEBHOOK_URL=https://hooks.slack.com/...

pnpm exec crashwatch validate --config ./crashwatch.yaml
pnpm exec crashwatch check    --config ./crashwatch.yaml --dry-run
pnpm exec crashwatch check    --config ./crashwatch.yaml
```

Full walk-through + config reference: [`docs/MANUAL.md`](./docs/MANUAL.md).

See [`examples/single-app/config.yaml`](./examples/single-app/config.yaml) for a Firebase + Sentry starter.

## Writing a plugin

```ts
// my-provider.ts
import type { ProviderFactory, CrashProvider, Issue, AppRef } from "@hx2ryu/crashwatch-core";

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

- **[Manual](./docs/MANUAL.md)** — the master guide; start here.
- [Release runbook](./docs/release.md)
- [Public roadmap](./docs/ROADMAP.md)
- [Writing a provider](./docs/writing-a-provider.md) / [notifier](./docs/writing-a-notifier.md)
- [Playbooks for common crash categories](./docs/playbooks/README.md) (stubs)
- Short quick-start: [`docs/getting-started.md`](./docs/getting-started.md)
- Legacy config ref (superseded by MANUAL): [`docs/configuration.md`](./docs/configuration.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and small PRs are welcome; for larger changes please open a discussion first.

## License

[MIT](./LICENSE)
