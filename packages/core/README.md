# @crashwatch/core

Vendor-neutral types, config loader, detector, and storage primitives for [crashwatch](../../README.md).

## What this is

`@crashwatch/core` is the glue. It defines the shapes everything else speaks in — `Issue`, `CrashEvent`, `Alert`, `Snapshot` — plus the plugin interfaces (`CrashProvider`, `Notifier`, `IssueTracker`) that providers, notifiers, and trackers implement.

**Hard rule:** no vendor logic lives here. The core never imports a vendor SDK and never names a specific product in its public types. Firebase Crashlytics, Sentry, Bugsnag, Slack — all of that belongs in plugin packages. If a change to `@crashwatch/core` is tempting you to import or even mention a vendor, it belongs in a plugin instead.

## Install

```bash
pnpm add @crashwatch/core
```

One runtime dependency: [`yaml`](https://www.npmjs.com/package/yaml). Requires Node ≥ 18.

## Public surface

### Types

- `Issue`, `IssueDetail`, `CrashEvent`, `StackFrame`, `Snapshot`, `Alert`, `MetricsWindow`, `ReportRow` — the data the core operates on.
- `AppRef`, `Platform`, `ErrorType` — how an app is addressed.
- `IssueFilter`, `EventFilter`, `ReportKind` — query inputs the CLI hands to providers.

### Plugin interfaces

- `CrashProvider` + `ProviderFactory<TOptions>` — implement this in `@crashwatch/provider-*` packages.
- `Notifier` + `NotifierFactory<TOptions>` — implement this in `@crashwatch/notifier-*` packages.
- `IssueTracker` + `TrackerFactory<TOptions>` — implement this in `@crashwatch/tracker-*` packages.
- `ProviderCapability` — the string enum used by `CrashProvider.supports()` (`listIssues`, `listEvents`, `getReport`, `pagination`, `signals`).

### Config

- `loadConfig(path, env?)` — reads YAML or JSON, expands `${ENV_VAR}` and `${ENV_VAR:-default}` references, and shallow-validates required fields. Returns `{ config, configDir }`.
- `expandEnv(value, env?)` — recursively substitutes environment variables inside strings, arrays, and plain objects. Exposed for plugins that parse their own sub-config.
- `CrashwatchConfig`, `AppConfig`, `Thresholds`, `ProviderRef`, `NotifierRef`, `TrackerRef` — config types.
- `DEFAULT_THRESHOLDS` — the fallback detector thresholds (`regressionPct: 20`, `newIssueEvents24h: 5`, `regressionSignals: ["SIGNAL_REGRESSED", "SIGNAL_EARLY"]`).

### Store

- `SnapshotStore` — append-only interface: `appendSnapshot`, `appendAlert`, `readRecentSnapshots`.
- `JsonlSnapshotStore` — default implementation; writes one JSON object per line under `<baseDir>/snapshots/<app>.jsonl` and `<baseDir>/alerts/<app>.jsonl`. Inspectable, diff-able, never rewritten in place.

### Detector

- `Detector = (current, history, thresholds) => Alert[]` — the detector signature.
- `defaultDetector` — ships three rules, evaluated per issue:
  - **`new_issue`** — issue id not present in any historical snapshot and `recentEvents >= thresholds.newIssueEvents24h`.
  - **`spike`** — `recentEvents` grew by `>= thresholds.regressionPct` versus the same-weekday snapshot from ~7 days ago.
  - **`regression`** — issue carries any signal listed in `thresholds.regressionSignals` (e.g. Sentry's `SIGNAL_REGRESSED`).

Precedence: a regression signal always fires; new-issue short-circuits spike detection on brand-new ids.

## Writing a plugin

Every plugin package default-exports a factory with the shape `(options) => instance | Promise<instance>`. The CLI resolver also accepts `createPlugin` as a named export if `default` is inconvenient.

```ts
// my-provider.ts
import type {
  AppRef,
  CrashProvider,
  Issue,
  IssueFilter,
  ProviderFactory,
} from "@crashwatch/core";

const factory: ProviderFactory<{ apiKey: string }> = ({ apiKey }): CrashProvider => ({
  id: "my-provider",
  async listIssues(app: AppRef, filter: IssueFilter): Promise<Issue[]> {
    // call your API, map into the core Issue shape
    return [];
  },
  async getIssue() {
    throw new Error("not implemented");
  },
  async listEvents() {
    return [];
  },
});

export default factory;
```

Real-world implementations worth reading before writing your own:

- [`@crashwatch/provider-firebase`](../provider-firebase) — BigQuery-backed provider, lazy-loads a heavy SDK.
- [`@crashwatch/provider-sentry`](../provider-sentry) — pure `fetch`, cursor pagination, provider-emitted signals.
- [`@crashwatch/notifier-webhook`](../notifier-webhook) — minimal notifier with a body-template switch.

## Development

```bash
pnpm --filter @crashwatch/core test
pnpm --filter @crashwatch/core build
```

Tests use `tsx` + `node --test`; no build step is required to run them.
