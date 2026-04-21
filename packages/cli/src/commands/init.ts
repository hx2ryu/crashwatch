import { writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";

import { parseArgs } from "../index.js";

const STARTER = `# crashwatch config — see docs/configuration.md for full reference.
version: 1

defaults:
  thresholds:
    regressionPct: 20
    newIssueEvents24h: 5
    regressionSignals: [SIGNAL_REGRESSED, SIGNAL_EARLY]

providers:
  - id: firebase
    plugin: "@hx2ryu/crashwatch-provider-firebase"
    options:
      projectId: "your-gcp-project"
      credentials: "\${GOOGLE_APPLICATION_CREDENTIALS}"

notifiers:
  - id: webhook
    plugin: "@hx2ryu/crashwatch-notifier-webhook"
    options:
      url: "\${CRASHWATCH_WEBHOOK_URL}"

apps:
  - name: example-app
    platforms:
      android:
        providerOptions:
          # Fully-qualified BigQuery table from your Crashlytics export.
          bigqueryTable: "your-gcp-project.firebase_crashlytics.example_app_ANDROID"
    providers: [firebase]
    notify: [webhook]
`;

export async function init(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const target = resolve(args.config);
  try {
    await access(target);
    process.stderr.write(`Refusing to overwrite existing ${target}\n`);
    process.exit(1);
  } catch {
    // falls through to write
  }
  await writeFile(target, STARTER, "utf8");
  process.stdout.write(`Wrote starter config to ${target}\n`);
  process.stdout.write(
    `Next: fill in credentials, then run \`crashwatch validate\`.\n`,
  );
}
