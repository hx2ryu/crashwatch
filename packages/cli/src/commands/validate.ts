import { loadConfig } from "@hx2ryu/crashwatch-core";

import { parseArgs } from "../index.js";
import { resolvePlugins } from "../plugins.js";

export async function validate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const { config, configDir } = await loadConfig(args.config);
  const { providers, notifiers, trackers } = await resolvePlugins(
    config,
    configDir,
  );
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          apps: config.apps.map((a) => a.name),
          providers: providers.map((p) => p.id),
          notifiers: notifiers.map((n) => n.id),
          trackers: trackers.map((t) => t.id),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  process.stdout.write(`Config: ${args.config}\n`);
  process.stdout.write(`Apps:      ${config.apps.map((a) => a.name).join(", ")}\n`);
  process.stdout.write(`Providers: ${providers.map((p) => p.id).join(", ")}\n`);
  process.stdout.write(`Notifiers: ${notifiers.map((n) => n.id).join(", ")}\n`);
  if (trackers.length) {
    process.stdout.write(`Trackers:  ${trackers.map((t) => t.id).join(", ")}\n`);
  }
  process.stdout.write(`OK\n`);
}
