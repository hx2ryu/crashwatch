import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import type { Platform } from "./types.js";

/**
 * Loads a crashwatch config file (YAML or JSON) and expands ${ENV_VAR}
 * references. Validation is intentionally shallow — plugins validate their
 * own option objects at construction time.
 */
export interface CrashwatchConfig {
  version: 1;
  defaults?: Partial<AppDefaults>;
  providers: ProviderRef[];
  notifiers: NotifierRef[];
  trackers?: TrackerRef[];
  apps: AppConfig[];
}

export interface AppDefaults {
  thresholds: Thresholds;
  dismissPatterns: string[];
  notify: string[];
}

export interface Thresholds {
  /** Relative increase over baseline (percent) that counts as a spike. */
  regressionPct: number;
  /** New issue events-in-24h floor before we alert. */
  newIssueEvents24h: number;
  /** Provider signals that, if present on an issue, always alert. */
  regressionSignals: string[];
}

export interface AppConfig {
  name: string;
  displayName?: string;
  owners?: string[];
  platforms: Partial<Record<Platform, PlatformConfig>>;
  /** Which of the top-level providers to query for this app (by id). */
  providers?: string[];
  /** Which notifiers to use for this app's alerts (by id). */
  notify?: string[];
  trackers?: string[];
  thresholds?: Partial<Thresholds>;
  dismissPatterns?: string[];
}

export interface PlatformConfig {
  /** Free-form options handed to the provider; shape depends on provider. */
  providerOptions: Record<string, unknown>;
}

export interface ProviderRef {
  /** Logical id used by apps to reference this provider. */
  id: string;
  /** Module specifier or local path of the plugin. */
  plugin: string;
  options?: Record<string, unknown>;
}

export interface NotifierRef {
  id: string;
  plugin: string;
  options?: Record<string, unknown>;
}

export interface TrackerRef {
  id: string;
  plugin: string;
  options?: Record<string, unknown>;
}

const ENV_RE = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

/** Replace `${FOO}` or `${FOO:-default}` with process.env values. */
export function expandEnv<T>(value: T, env = process.env): T {
  if (typeof value === "string") {
    return value.replace(ENV_RE, (_, name, fallback) => {
      const v = env[name];
      if (v !== undefined && v !== "") return v;
      if (fallback !== undefined) return fallback;
      return "";
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandEnv(v, env)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = expandEnv(v, env);
    }
    return out as T;
  }
  return value;
}

export async function loadConfig(
  configPath: string,
  env = process.env,
): Promise<{ config: CrashwatchConfig; configDir: string }> {
  const absPath = isAbsolute(configPath) ? configPath : resolve(configPath);
  const raw = await readFile(absPath, "utf8");
  const parsed = absPath.endsWith(".json")
    ? JSON.parse(raw)
    : parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Config at ${absPath} did not parse to an object.`);
  }
  const expanded = expandEnv(parsed, env) as CrashwatchConfig;
  assertShape(expanded, absPath);
  return { config: expanded, configDir: dirname(absPath) };
}

function assertShape(cfg: unknown, path: string): asserts cfg is CrashwatchConfig {
  if (!cfg || typeof cfg !== "object") {
    throw new Error(`Config at ${path} is not an object.`);
  }
  const c = cfg as Record<string, unknown>;
  if (c.version !== 1) {
    throw new Error(`Unsupported config version: ${String(c.version)} (expected 1).`);
  }
  if (!Array.isArray(c.apps) || c.apps.length === 0) {
    throw new Error(`Config must declare at least one app under "apps".`);
  }
  if (!Array.isArray(c.providers) || c.providers.length === 0) {
    throw new Error(`Config must declare at least one provider.`);
  }
  if (!Array.isArray(c.notifiers)) {
    throw new Error(`Config must declare "notifiers" (can be empty array).`);
  }
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  regressionPct: 20,
  newIssueEvents24h: 5,
  regressionSignals: ["SIGNAL_REGRESSED", "SIGNAL_EARLY"],
};
