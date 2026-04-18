import { check } from "./commands/check.js";
import { init } from "./commands/init.js";
import { validate } from "./commands/validate.js";

const HELP = `crashwatch — vendor-neutral crash observability runner

Usage:
  crashwatch <command> [options]

Commands:
  init        Scaffold a starter config in the current directory
  validate    Load a config and resolve all plugins without running anything
  check       Collect the current snapshot, run detection, dispatch alerts
  help        Show this message

Common options:
  -c, --config <path>   Path to config file (default: ./crashwatch.yaml)
      --state <dir>     State/snapshots directory (default: ./.crashwatch)
      --dry-run         Skip dispatching notifiers; print alerts to stdout
      --json            Emit machine-readable JSON where applicable
`;

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return;
    case "init":
      await init(rest);
      return;
    case "validate":
      await validate(rest);
      return;
    case "check":
      await check(rest);
      return;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(2);
  }
}

export interface ParsedArgs {
  config: string;
  stateDir: string;
  dryRun: boolean;
  json: boolean;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    config: "./crashwatch.yaml",
    stateDir: "./.crashwatch",
    dryRun: false,
    json: false,
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-c" || a === "--config") out.config = argv[++i] ?? out.config;
    else if (a === "--state") out.stateDir = argv[++i] ?? out.stateDir;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a && !a.startsWith("-")) out.positional.push(a);
  }
  return out;
}
