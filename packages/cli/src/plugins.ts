import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

import { defaultDetector, loadConfig } from "@crashwatch/core";
import type {
  CrashProvider,
  CrashwatchConfig,
  Detector,
  DetectorFactory,
  IssueTracker,
  Notifier,
  NotifierFactory,
  ProviderFactory,
  TrackerFactory,
} from "@crashwatch/core";

interface Resolved {
  config: CrashwatchConfig;
  providers: CrashProvider[];
  notifiers: Notifier[];
  trackers: IssueTracker[];
  detector: Detector;
}

/** Load config and all plugins referenced by it. */
export async function loadAndResolve(configPath: string): Promise<Resolved> {
  const { config, configDir } = await loadConfig(configPath);
  const { providers, notifiers, trackers, detector } = await resolvePlugins(
    config,
    configDir,
  );
  return { config, providers, notifiers, trackers, detector };
}

export async function resolvePlugins(
  config: CrashwatchConfig,
  configDir: string,
): Promise<{
  providers: CrashProvider[];
  notifiers: Notifier[];
  trackers: IssueTracker[];
  detector: Detector;
}> {
  const providers: CrashProvider[] = [];
  for (const ref of config.providers) {
    const factory = await loadFactory<ProviderFactory>(ref.plugin, configDir);
    const instance = await factory(ref.options ?? {});
    providers.push(overrideId(instance, ref.id));
  }

  const notifiers: Notifier[] = [];
  for (const ref of config.notifiers) {
    const factory = await loadFactory<NotifierFactory>(ref.plugin, configDir);
    const instance = await factory(ref.options ?? {});
    notifiers.push(overrideId(instance, ref.id));
  }

  const trackers: IssueTracker[] = [];
  for (const ref of config.trackers ?? []) {
    const factory = await loadFactory<TrackerFactory>(ref.plugin, configDir);
    const instance = await factory(ref.options ?? {});
    trackers.push(overrideId(instance, ref.id));
  }

  const detector = await resolveDetector(config, configDir);

  return { providers, notifiers, trackers, detector };
}

async function resolveDetector(
  config: CrashwatchConfig,
  configDir: string,
): Promise<Detector> {
  if (!config.detector) return defaultDetector;
  const factory = await loadFactory<DetectorFactory>(
    config.detector.plugin,
    configDir,
  );
  const instance = await factory(config.detector.options ?? {});
  if (typeof instance !== "function") {
    throw new Error(
      `Detector plugin "${config.detector.plugin}" factory must return a ` +
        "function of the signature (current, history, thresholds) => Alert[].",
    );
  }
  return instance;
}

async function loadFactory<T>(spec: string, configDir: string): Promise<T> {
  const target = spec.startsWith(".") || isAbsolute(spec)
    ? pathToFileURL(resolve(configDir, spec)).href
    : spec;
  const mod = (await import(target)) as { default?: T; createPlugin?: T };
  const factory = mod.default ?? mod.createPlugin;
  if (typeof factory !== "function") {
    throw new Error(
      `Plugin "${spec}" must default-export (or export createPlugin) a factory function.`,
    );
  }
  return factory as T;
}

function overrideId<T extends { id: string }>(instance: T, id: string): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (prop === "id") return id;
      return Reflect.get(target, prop, receiver);
    },
  });
}
