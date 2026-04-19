import { DEFAULT_THRESHOLDS, JsonlSnapshotStore } from "@crashwatch/core";
import type {
  Alert,
  AppConfig,
  AppRef,
  CrashProvider,
  Issue,
  Notifier,
  Platform,
  Snapshot,
  Thresholds,
} from "@crashwatch/core";

import { parseArgs } from "../index.js";
import { loadAndResolve } from "../plugins.js";

export async function check(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const { config, providers, notifiers, detector } = await loadAndResolve(
    args.config,
  );

  const store = new JsonlSnapshotStore(args.stateDir);
  const runId = new Date().toISOString();

  for (const app of config.apps) {
    const thresholds = mergeThresholds(config.defaults?.thresholds, app.thresholds);
    const providersForApp = pickProviders(app, providers);

    for (const [platform, platformCfg] of Object.entries(app.platforms)) {
      if (!platformCfg) continue;
      const appRef: AppRef = {
        name: app.name,
        platform: platform as Platform,
        providerOptions: platformCfg.providerOptions,
      };
      for (const provider of providersForApp) {
        const snapshot = await collect(provider, appRef);
        await store.appendSnapshot(snapshot);

        const history = await store.readRecentSnapshots(app.name, 50);
        const alerts = detector(snapshot, history.slice(0, -1), thresholds);

        if (args.dryRun || alerts.length === 0) {
          emitDry(args.json, app.name, alerts);
        } else {
          await dispatch(alerts, pickNotifiers(app, notifiers), runId, store);
        }
      }
    }
  }
}

async function collect(provider: CrashProvider, app: AppRef): Promise<Snapshot> {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const issues = await provider.listIssues(app, {
    limit: 20,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  // Prefer counts attached to the issue by the provider (cheap: one query for
  // all issues). Fall back to a per-issue listEvents call only when absent.
  const issueEntries = await Promise.all(
    issues.map(async (issue) => {
      let events = issue.recentEvents;
      if (events === undefined) {
        const ev = await provider.listEvents(app, {
          issueId: issue.id,
          from: from.toISOString(),
          to: to.toISOString(),
          limit: 1000,
        });
        events = ev.length;
      }
      return {
        issue,
        recent: {
          windowStart: from.toISOString(),
          windowEnd: to.toISOString(),
          events,
          impactedUsers: issue.recentImpactedUsers,
        },
      };
    }),
  );

  return {
    capturedAt: new Date().toISOString(),
    appName: app.name,
    platform: app.platform,
    issues: issueEntries,
  };
}

async function dispatch(
  alerts: Alert[],
  notifiers: Notifier[],
  runId: string,
  store: JsonlSnapshotStore,
): Promise<void> {
  for (const alert of alerts) {
    await store.appendAlert(alert);
    for (const n of notifiers) {
      try {
        await n.notify(alert, {
          appName: alert.appName,
          runId,
          options: {},
        });
      } catch (err) {
        process.stderr.write(
          `[crashwatch] notifier ${n.id} failed: ${(err as Error).message}\n`,
        );
      }
    }
  }
}

function emitDry(json: boolean, app: string, alerts: Alert[]): void {
  if (json) {
    process.stdout.write(JSON.stringify({ app, alerts }) + "\n");
    return;
  }
  if (alerts.length === 0) {
    process.stdout.write(`[${app}] no alerts\n`);
    return;
  }
  for (const a of alerts) {
    process.stdout.write(`[${app}] ${a.level.toUpperCase()} ${a.kind} — ${a.title}\n`);
    process.stdout.write(`    ${a.summary}\n`);
  }
}

function pickProviders(
  app: AppConfig,
  all: CrashProvider[],
): CrashProvider[] {
  if (!app.providers || app.providers.length === 0) return all;
  return all.filter((p) => app.providers!.includes(p.id));
}

function pickNotifiers(app: AppConfig, all: Notifier[]): Notifier[] {
  if (!app.notify || app.notify.length === 0) return all;
  return all.filter((n) => app.notify!.includes(n.id));
}

function mergeThresholds(
  defaults: Partial<Thresholds> | undefined,
  override: Partial<Thresholds> | undefined,
): Thresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...(defaults ?? {}),
    ...(override ?? {}),
  };
}
