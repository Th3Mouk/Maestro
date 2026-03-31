# Dependency Governance

This document defines how Maestro treats dependencies for the published CLI.

Maestro is a published application, not a reusable library.
Dependency decisions therefore optimize for a controlled user distribution, a small runtime surface, and maintainable release operations.

## What ships to users

The published `maestro` command is a Node program, not a standalone binary.
The npm package ships the built CLI, docs, examples, and framework packs; users still execute the command through Node at runtime.

That distinction matters for dependency policy:

- runtime dependencies affect the installed CLI behavior directly;
- development dependencies affect maintainers and CI, not the installed CLI;
- Homebrew installs the npm tarball, so it consumes the same published artifact rather than a separate Homebrew-specific build.

The runtime dependency surface is intentionally small.
Keep it that way unless a new dependency removes meaningful local complexity or closes a concrete correctness or security gap.

Baseline observed on 2026-03-31:

- the published CLI is a Node program, not a standalone binary;
- the runtime tree contained 10 direct dependencies and 37 production packages in total;
- `pnpm audit --prod` and the full local audit both returned no known vulnerabilities at that point in time;
- the production dependency tree contained no `preinstall`, `install`, or `postinstall` scripts.

## Risk model

The main dependency risk is not only a vulnerable npm package.
Maestro also orchestrates local tools such as `git`, `bash`, package managers, and repository bootstrap commands inside downstream repositories.

That means dependency governance must cover two separate concerns:

- supply-chain risk from runtime and transitive npm dependencies;
- operator risk from a CLI that can execute trusted local tools against repositories chosen by the workspace contract.

Security-major dependency updates take priority over routine freshness.
When a major vulnerability affects the shipped CLI, the project should publish an update even if there is no broader release planned.

Dependency review happens in three tiers:

- runtime dependencies shipped to users: highest priority, explicit justification, fast reaction to security advisories and install regressions;
- development and tooling dependencies: lower urgency, batch-friendly, acceptable to defer when the validation path stays healthy;
- platform dependencies such as Node LTS, pnpm, and GitHub Actions: security and compatibility maintenance take priority over routine churn.

## Update policy

Dependabot provides the regular update signal for npm dependencies and GitHub Actions.
Those proposals are review input, not a promise that every available update will trigger a release.

Publish a new CLI version when one of these is true:

- a major security issue affects the shipped runtime dependency tree;
- a supported Node LTS line needs a compatibility update;
- a dependency regression blocks install, pack, or command execution;
- a dependency update is required for a shipped capability.

It is acceptable to defer routine non-security updates when the current tree is stable and validated.

## Pinning policy

Do not exact-pin every dependency in `package.json`.
Maestro keeps semver ranges in the manifest so maintainers can absorb compatible fixes without turning every bump into manual package metadata churn.

The default controls are:

- `pnpm-lock.yaml` is the maintainer truth for development, CI, and release validation;
- `npm-shrinkwrap.json` is the pinned consumer artifact for npm-based installs of the published CLI;
- the release workflow installs with `pnpm install --frozen-lockfile`;
- the release pipeline validates the packed tarball through a local npm install and checks that the installed tree still matches `npm-shrinkwrap.json`;
- tighter version pinning is a targeted response, not the baseline posture.

Use an exact pin or a narrower range only when one of these is true:

- a specific dependency release is known-bad;
- a compatibility regression needs to be isolated quickly;
- a runtime dependency has repeatedly broken within its allowed semver window.

Do not use exact version pins in `package.json` as the primary reproducibility control.
Use the maintainer lockfile plus the published shrinkwrap instead.

## Maintainer hardening

The repository keeps maintainer installs explicit and conservative:

- `packageManager` pins the exact pnpm line expected by the repository and CI;
- `minimumReleaseAge: 1440` delays adoption of just-published packages by 24 hours;
- `strictDepBuilds: true` keeps dependency build scripts opt-in;
- `onlyBuiltDependencies` documents the explicit allowlist for build-script packages required by the toolchain.

## Release provenance

Maestro treats GitHub Actions OIDC trusted publishing with npm provenance as the standard package-signing control for public releases.
The release workflow must keep:

- `permissions.id-token: write`;
- npm publication from GitHub Actions;
- `npm publish ... --provenance`.

The repository validates that release contract internally.
It also validates the packed tarball locally through `npm install`, `npm audit signatures`, and the shipped shrinkwrap.
It does not publish test releases to npm or Homebrew just to verify the policy.
