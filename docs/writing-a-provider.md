# Writing a provider

A provider is a plugin that adapts one crash-reporting backend into the crashwatch core types. Your job is to answer three questions:

1. Given an app, what issues exist right now? (`listIssues`)
2. Given an issue id, what does it look like in detail? (`getIssue`)
3. Given a filter, what raw events match? (`listEvents`)

Optionally, if your backend exposes numeric reports (top devices, top OS versions, …), implement `getReport`.

## Skeleton

```ts
import type {
  AppRef,
  CrashEvent,
  CrashProvider,
  EventFilter,
  Issue,
  IssueDetail,
  IssueFilter,
  ProviderFactory,
} from "@hx2ryu/crashwatch-core";

interface MyOptions { apiKey: string }

const factory: ProviderFactory<MyOptions> = ({ apiKey }): CrashProvider => {
  // Construct SDK clients here.
  return {
    id: "my-backend",
    async listIssues(app: AppRef, filter: IssueFilter): Promise<Issue[]> {
      // Use app.providerOptions for backend-specific identifiers.
      return [];
    },
    async getIssue(app: AppRef, issueId: string): Promise<IssueDetail> {
      // Hydrate with a sample event when cheap.
      throw new Error("not implemented");
    },
    async listEvents(app: AppRef, filter: EventFilter): Promise<CrashEvent[]> {
      return [];
    },
  };
};

export default factory;
```

## Mapping rules

- **Time values are ISO strings.** Don't leak Date objects across the interface; serialize at the boundary.
- **Platform is lowercase.** `android | ios | web | backend | other`.
- **Raw payload.** Stash the original response on `Issue.raw` or `CrashEvent.raw` for debugging; nothing downstream relies on its shape.
- **Pagination.** If your backend exposes cursors, accept `pageToken` in `IssueFilter` and respect `limit`. If it doesn't, ignore both.

## Capability declaration

If your provider cannot serve a given method, declare it via `supports()`:

```ts
supports(cap) { return cap === "listIssues" || cap === "listEvents"; }
```

The runner skips calls for unsupported capabilities.

## Testing

A provider contract test lives in `packages/core/tests/provider-contract.ts` (TBD). Run it against your factory with a recorded fixture so regressions are loud.
