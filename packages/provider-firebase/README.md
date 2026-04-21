# @hx2ryu/crashwatch-provider-firebase

Firebase Crashlytics provider for [crashwatch](../../README.md).

## What this actually queries

Firebase does **not** publish a stable public REST API for listing Crashlytics issues or events. The only officially supported machine-readable source is the **Crashlytics → BigQuery export**. This provider runs parameterized SQL against that export.

If you haven't enabled BigQuery export yet, see Firebase's docs:
https://firebase.google.com/docs/crashlytics/bigquery-export

The export produces one table per platform, named like:

```
<project>.firebase_crashlytics.<app_id_slug>_<PLATFORM>
```

You pass the fully qualified name to the provider per app (see below).

## Install

```bash
pnpm add @hx2ryu/crashwatch-provider-firebase @google-cloud/bigquery
```

`@google-cloud/bigquery` is a peer dependency so the package can be installed without it until you actually wire Firebase in.

## Authenticate

Any authentication scheme that `@google-cloud/bigquery` accepts works:

- **Application Default Credentials** (recommended on GCE, GKE, Cloud Run, or after `gcloud auth application-default login`) — pass nothing.
- **Service account key file** — pass `credentials: "/path/to/key.json"`.
- **Inline credentials object** — pass `credentials: { client_email, private_key, ... }`.

Minimum IAM roles on the dataset:
- `roles/bigquery.dataViewer`
- `roles/bigquery.jobUser`

## Configure

```yaml
version: 1
providers:
  - id: firebase
    plugin: "@hx2ryu/crashwatch-provider-firebase"
    options:
      projectId: "my-gcp-project"
      credentials: "${GOOGLE_APPLICATION_CREDENTIALS}"
      defaultWindowHours: 24        # optional

apps:
  - name: example-app
    platforms:
      android:
        providerOptions:
          bigqueryTable: "my-gcp-project.firebase_crashlytics.example_app_ANDROID"
      ios:
        providerOptions:
          bigqueryTable: "my-gcp-project.firebase_crashlytics.example_app_IOS"
    providers: [firebase]
```

## Capabilities

| Capability | Supported |
|---|---|
| `listIssues` | ✅ |
| `listEvents` | ✅ |
| `getReport("topVersions")` | ✅ |
| `getReport("topDevices")` | ✅ |
| `getReport("topOperatingSystems")` | ✅ |
| Pagination | ❌ (BigQuery returns the full result set) |
| Provider-emitted signals (regressed/fresh) | ❌ (not present in the export) |

Because Crashlytics "signals" (`SIGNAL_REGRESSED`, `SIGNAL_EARLY`, …) are not carried in the BigQuery export, detection relies on the default comparative rules (new issue, week-over-week spike) rather than provider hints.

## Cost notes

- BigQuery bills by bytes scanned. The Crashlytics export is partitioned by `event_timestamp` — always include a `from`/`to` window. The core runner does this by default (24 h).
- Prefer a partitioned-table layout if you manage exports yourself; Firebase's managed export does this for you.
- Consider scheduling aggregates into a **small summary table** and pointing this provider at that instead for high-traffic apps.

## Schema reference

The provider relies on these columns of the standard export schema:

- `event_timestamp` (TIMESTAMP)
- `issue_id` (STRING), `issue_title`, `issue_subtitle`
- `is_fatal` (BOOL)
- `application.display_version` / `application.build_version`
- `user.id` (for impacted-user counts)
- `device.manufacturer`, `device.model`
- `operating_system.name`, `operating_system.display_version`
- `exceptions`, `breadcrumbs`, `blame_frame` (nested records)

If Firebase changes the schema, bump the package minor version and add a migration note to `CHANGELOG.md`.
