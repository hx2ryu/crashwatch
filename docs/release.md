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

## One-time setup: `NPM_TOKEN`

The workflow needs a **granular access token** stored as the `NPM_TOKEN` repo secret.

### Create the token

1. Sign in at https://www.npmjs.com/settings/hx2ryu/tokens/granular-access-tokens/new
2. Name it `crashwatch-release`.
3. Expiration: pick whatever you're comfortable with (30 days / 1 year).
4. **Packages and scopes** → *Selected packages and scopes* → add `@hx2ryu/*` with **Read and write**.
5. **Permissions** → check **"Bypass two-factor authentication when publishing"**. Without this, npm returns `EOTP` during workflow runs and 2FA-protected accounts cannot publish non-interactively.
6. Generate and copy the token — you will only see it once.

### Store the token in the repo

```bash
gh secret set NPM_TOKEN --body "<paste_token_here>"
gh secret list     # confirm NPM_TOKEN is present
```

(Or, via the UI: *Settings → Secrets and variables → Actions → New repository secret*.)

## Provenance

`id-token: write` + `--provenance` + `NPM_CONFIG_PROVENANCE: "true"` produce a GitHub-OIDC-signed attestation bundled into each tarball. Because the repo is public, npm surfaces the ✓ **Provenance** badge next to every published version and lets consumers verify with `npm audit signatures`.

If the repo were private, the workflow would fail the provenance step; drop `--provenance` and the `NPM_CONFIG_PROVENANCE` env in that case.

## Publishing manually (bypass / emergency)

1. `npm login` on a trusted machine.
2. `pnpm -r publish --access public --tag alpha --no-git-checks` (add `--otp=<code>` if 2FA prompts).

Prefer the CI path — the manual path skips CI's build verification and loses provenance.

## Rollback

npm tarballs are immutable. Options when a release is broken:

- **Within 72 hours** of publish, `npm unpublish @hx2ryu/crashwatch-<pkg>@<version>` works. Use sparingly — npm recommends against it for packages others depend on.
- **After 72 hours**, unpublish is disallowed. Publish a fix as the next patch version and `npm deprecate @hx2ryu/crashwatch-<pkg>@<broken-version> "use ^<fix-version> instead"`.

## Migrating to full OIDC (future)

Once each package is published at least once, configure **Trusted Publishers** under each package's npm settings to point at this workflow. That removes the need for `NPM_TOKEN` entirely — npm issues short-lived credentials per workflow run via OIDC. Worth doing before 1.0.
