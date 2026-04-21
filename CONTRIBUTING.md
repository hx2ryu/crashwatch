# Contributing to crashwatch

Thanks for your interest. crashwatch is pre-alpha — APIs will change — but we value external feedback early.

## Ground rules

- **Vendor-neutrality is the whole point.** Changes to `@hx2ryu/crashwatch-core` must not introduce a dependency on any specific provider, notifier, or tracker. If you find yourself adding `firebase-admin` or `@slack/web-api` to `core`, split it into a plugin.
- **Plugins are packages.** A plugin should be installable and usable on its own.
- **Config is the user interface.** Prefer a new config option over a new CLI flag; prefer a plugin option over a config option.
- **Small, inspectable state.** Default storage stays JSONL on disk. Other backends are plugins.

## Development

```bash
# One-time
corepack enable
pnpm install

# Build all packages
pnpm -r build

# Typecheck everything
pnpm typecheck
```

## Project layout

```
packages/
  core/                 # vendor-neutral core
  cli/                  # command runner
  provider-firebase/    # reference provider
  notifier-webhook/     # reference notifier (generic HTTP)
  notifier-slack/       # convenience wrapper over notifier-webhook
examples/               # runnable example configs
schemas/                # JSON Schema for config editor support
docs/                   # user-facing docs
```

## Coding conventions

- TypeScript strict mode. No `any` in public types.
- ESM only. `.js` extensions in relative imports (required by Node ESM).
- Node 18+ runtime features are fair game (`fetch`, `AbortSignal.timeout`, etc.).
- Error messages are user-facing; make them actionable.

## Pull requests

- Keep diffs focused. Refactors go in separate PRs from features.
- Run `pnpm -r typecheck` before pushing.
- If you add or change a plugin API, update `docs/` in the same PR.
- If a change affects the config file, update `schemas/config.schema.json` and at least one example under `examples/`.

## Releasing (maintainers)

- Packages use independent semver. A release is a git tag of the form `<package>@<version>`.
- pre-1.0 breaking changes may land in minor releases, but must appear in the package's `CHANGELOG.md`.
