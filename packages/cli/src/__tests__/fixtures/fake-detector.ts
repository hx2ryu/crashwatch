import type { Detector, DetectorFactory } from "@crashwatch/core";

/**
 * Deterministic fake detector for CLI end-to-end tests.
 *
 * Emits a single `custom` alert per issue in the current snapshot whose title
 * matches the configured needle. Lets tests assert that the CLI is routing
 * the configured detector's output to notifiers — without having to replicate
 * the real detector's full rule set.
 */
interface Options {
  /** Case-sensitive substring to match in Issue.title. */
  titleIncludes?: string;
  /** Optional marker in the emitted alert summary so tests can verify routing. */
  marker?: string;
}

const factory: DetectorFactory<Options> = (options) => {
  const detector: Detector = (current) => {
    const needle = options?.titleIncludes ?? "";
    const marker = options?.marker ?? "fake-detector";
    return current.issues
      .filter(({ issue }) => !needle || issue.title.includes(needle))
      .map(({ issue }) => ({
        id: `${current.appName}:${issue.id}:custom:${current.capturedAt}`,
        level: "warning" as const,
        kind: "custom" as const,
        title: `[${current.appName}] custom — ${issue.title}`,
        summary: `${marker}: matched ${issue.title}`,
        appName: current.appName,
        platform: current.platform,
        issue,
        links: [],
        emittedAt: new Date().toISOString(),
        context: { marker, issueId: issue.id },
      }));
  };
  return detector;
};

export default factory;
