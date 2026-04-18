# Getting started

## Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9 (`corepack enable` is the simplest install)
- Credentials for at least one crash-reporting backend

## Install

```bash
git clone <your-fork>
cd crashwatch
pnpm install
pnpm -r build
```

## Scaffold a config

```bash
node packages/cli/bin/crashwatch.mjs init --config ./crashwatch.yaml
```

Open the file and fill in:
1. Provider credentials (or environment variable references)
2. Notifier URLs (Slack webhook, generic HTTP endpoint, …)
3. Each app's `providerOptions` (e.g. Firebase appId)

## Validate

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/..."
node packages/cli/bin/crashwatch.mjs validate --config ./crashwatch.yaml
```

`validate` loads the config, resolves every plugin, and prints the resulting app / provider / notifier ids. It does not contact any external service.

## Dry run

```bash
node packages/cli/bin/crashwatch.mjs check --config ./crashwatch.yaml --dry-run
```

This performs a full collection pass and writes a snapshot to `./.crashwatch/snapshots/<app>.jsonl`, but prints alerts to stdout instead of dispatching.

## Schedule

crashwatch is stateless between runs — everything it needs is in the state directory. Schedule it however you like:

```cron
0 * * * *  cd /srv/crashwatch && node packages/cli/bin/crashwatch.mjs check --config /etc/crashwatch.yaml
```

Kubernetes `CronJob`, GitHub Actions `schedule:`, systemd timer — all equally fine.
