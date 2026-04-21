import type { CrashProvider, ProviderFactory } from "@hx2ryu/crashwatch-core";

/**
 * Deterministic fake provider for CLI end-to-end tests.
 * The factory options control what listIssues returns so tests can drive
 * different scenarios from a single plugin file.
 */
interface Options {
  issues?: Array<{ id: string; title: string; events: number }>;
}

const factory: ProviderFactory<Options> = (options) => {
  const issues = options?.issues ?? [];
  const provider: CrashProvider = {
    id: "fake-provider",
    async listIssues() {
      return issues.map((i) => ({
        id: i.id,
        title: i.title,
        errorType: "fatal" as const,
        state: "open" as const,
        recentEvents: i.events,
      }));
    },
    async getIssue(_app, issueId) {
      return {
        id: issueId,
        title: "(fake)",
        errorType: "fatal",
        state: "open",
      };
    },
    async listEvents(_app, filter) {
      if (!filter.issueId) return [];
      const match = issues.find((i) => i.id === filter.issueId);
      if (!match) return [];
      return Array.from({ length: Math.min(match.events, filter.limit ?? 1) }).map(
        (_, idx) => ({
          id: `${match.id}:${idx}`,
          issueId: match.id,
          occurredAt: new Date().toISOString(),
        }),
      );
    },
  };
  return provider;
};

export default factory;
