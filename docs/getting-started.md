# Getting started

> Short quick-start. The full guide is in [`MANUAL.md`](./MANUAL.md).

## Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9 (`corepack enable` is the simplest install)
- Credentials for at least one crash-reporting backend (Sentry auth token, Firebase service-account JSON, …)

## Install

```bash
mkdir my-crashwatch && cd my-crashwatch
pnpm init -y
pnpm add -D @hx2ryu/crashwatch-cli@alpha \
             @hx2ryu/crashwatch-provider-sentry@alpha \
             @hx2ryu/crashwatch-notifier-slack@alpha
```

(Swap in `provider-firebase`, `notifier-webhook`, `tracker-github-issues` as needed.)

## Scaffold, validate, run

```bash
pnpm exec crashwatch init --config ./crashwatch.yaml
# edit crashwatch.yaml

export SENTRY_AUTH_TOKEN="sntrys_..."
export SLACK_WEBHOOK_URL="https://hooks.slack.com/..."

pnpm exec crashwatch validate --config ./crashwatch.yaml     # cheap: no external calls
pnpm exec crashwatch check    --config ./crashwatch.yaml --dry-run
pnpm exec crashwatch check    --config ./crashwatch.yaml     # live
```

## Schedule

crashwatch is stateless between runs — everything it needs lives in `--state` (default `./.crashwatch`). Any scheduler works:

```cron
0 * * * *  cd /srv/crashwatch && pnpm exec crashwatch check --config /etc/crashwatch.yaml
```

Kubernetes `CronJob`, GitHub Actions `schedule:`, systemd timer — all equally fine.

## Where to next

- [Manual](./MANUAL.md) — concepts, full config reference, scenarios, troubleshooting, extending.
- Per-package READMEs under [`packages/*/README.md`](../packages) for plugin-specific options.
