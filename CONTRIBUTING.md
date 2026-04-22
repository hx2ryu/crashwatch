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
  core/                      # vendor-neutral core
  cli/                       # command runner
  provider-firebase/         # BigQuery-export provider
  provider-sentry/           # REST-API provider
  notifier-webhook/          # reference notifier (generic HTTP)
  notifier-slack/            # convenience wrapper over notifier-webhook
  tracker-github-issues/     # GitHub Issues tracker
examples/                    # runnable example configs
schemas/                     # JSON Schema for config editor support
docs/                        # user-facing docs (start with MANUAL.md)
.github/workflows/           # ci.yml (every push) + release.yml (v*.*.* tag)
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

- All 7 packages release together under the same `0.1.0-alpha.N` version for the alpha line; the monorepo CHANGELOG tracks each N.
- A release is a `v*.*.*` git tag. The [`release.yml`](./.github/workflows/release.yml) workflow builds, tests, and publishes all packages with `--provenance`. See [`docs/release.md`](./docs/release.md) for the runbook and the NPM_TOKEN / dist-tag details.
- Pre-1.0 breaking changes may land in minor / alpha bumps, but must appear at the top of the root `CHANGELOG.md`.
