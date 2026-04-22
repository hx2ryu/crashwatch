# Release process

crashwatch publishes all 7 workspace packages to npm in lockstep from a single GitHub Actions workflow. Each release is triggered by pushing a git tag; no local `pnpm publish` is expected.

## TL;DR for a new release

```bash
# 1. make sure main is green and CHANGELOG [Unreleased] is accurate
# 2. bump versions (single command — pnpm handles cross-package deps)
pnpm -r exec -- npm version 0.1.0-alpha.1 --no-git-tag-version
pnpm install --lockfile-only           # refresh pnpm-lock.yaml

# 3. commit + tag + push
git commit -am "release: v0.1.0-alpha.1"
git tag v0.1.0-alpha.1
git push && git push --tags
```

GitHub Actions' `release.yml` takes over: it runs `pnpm install / build / typecheck / test`, derives the npm dist-tag from the version suffix, and publishes all packages with provenance.

## Dist-tag inference

The workflow picks a dist-tag from the tag name:

| Tag | dist-tag |
|---|---|
| `v0.1.0-alpha.0` | `alpha` |
| `v0.2.0-beta.3` | `beta` |
| `v0.3.0-rc.1` | `rc` |
| `v1.0.0` | `latest` |

Override via the `Run workflow` UI → `dist_tag` input if you need something else.

## Auth: npm Trusted Publishing (OIDC, no long-lived token)

Each of the 7 `@hx2ryu/crashwatch-*` packages has a **Trusted Publisher** configured on npmjs.com pointing at this repo's `release.yml` workflow. No `NPM_TOKEN` secret, no `--otp`, no rotation churn — the workflow mints short-lived OIDC credentials per run.

### One-time setup per package

For each of the 7 packages, visit `https://www.npmjs.com/package/@hx2ryu/crashwatch-<pkg>/access` → **Trusted Publishers** → **Add** and fill:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `hx2ryu` |
| Repository | `crashwatch` |
| Workflow filename | `release.yml` |
| Environment | _(leave blank)_ |

Packages: `crashwatch-core`, `crashwatch-cli`, `crashwatch-provider-firebase`, `crashwatch-provider-sentry`, `crashwatch-notifier-webhook`, `crashwatch-notifier-slack`, `crashwatch-tracker-github-issues`.

The initial bootstrap publish (`v0.1.0-alpha.0`) used a 1-day granular token with "Bypass 2FA" — kept only long enough to seed the registry so per-package Trusted Publisher UI could be used. That token has been revoked and the `NPM_TOKEN` secret deleted.

### Historical note

npm currently requires a package to exist in the registry before its Trusted Publisher can be configured. New packages added to this monorepo therefore follow the same bootstrap dance: short-lived granular token → first publish → configure Trusted Publisher → delete the token. Once npm adds pre-claim support for Trusted Publishers, this step goes away.

## Provenance

`id-token: write` + `--provenance` + `NPM_CONFIG_PROVENANCE: "true"` produce a GitHub-OIDC-signed attestation bundled into each tarball. Because the repo is public, npm surfaces the ✓ **Provenance** badge next to every published version and lets consumers verify with `npm audit signatures`.

If the repo were private, the workflow would fail the provenance step; drop `--provenance` and the `NPM_CONFIG_PROVENANCE` env in that case.

## Re-pointing `latest` / other dist-tags

npm autopopulates `latest` on first publish even when `--tag alpha` is explicitly passed, and refuses a bare `npm dist-tag rm ... latest` — every package must carry a `latest` entry. When `latest` drifts out of sync with `alpha` (usually after a new alpha release), use `.github/workflows/dist-tag-cleanup.yml`:

```bash
gh workflow run dist-tag-cleanup.yml -f target_version=0.1.0-alpha.N
```

The workflow re-points `latest` on all 7 packages to the given version. Safe to re-run; idempotent.

## Publishing manually (bypass / emergency)

1. `npm login` on a trusted machine.
2. `pnpm -r publish --access public --tag alpha --no-git-checks` (add `--otp=<code>` if 2FA prompts).

Prefer the CI path — the manual path skips CI's build verification and loses provenance.

## Rollback

npm tarballs are immutable. Options when a release is broken:

- **Within 72 hours** of publish, `npm unpublish @hx2ryu/crashwatch-<pkg>@<version>` works. Use sparingly — npm recommends against it for packages others depend on.
- **After 72 hours**, unpublish is disallowed. Publish a fix as the next patch version and `npm deprecate @hx2ryu/crashwatch-<pkg>@<broken-version> "use ^<fix-version> instead"`.
