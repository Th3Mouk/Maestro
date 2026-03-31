# Manifest Fragments

Fragments are small YAML files that contribute to a Maestro manifest without forcing everything into one file.
They exist for composition, reuse, and local overrides.

## Workspace fragments

Workspace fragments extend `maestro.yaml`.
By convention, Maestro looks for files under `fragments/` when they exist, and any relative path listed in `spec.includes` is also accepted.

Common uses:

- split repositories, runtimes, policies, execution, MCP servers, and plugin settings into separate files;
- keep the root manifest small and reviewable;
- let a workspace layer its own decisions on top of shared pack inputs.

Example layout:

```text
maestro.yaml
fragments/
|- repositories.yaml
|- runtimes.yaml
|- policies.yaml
`- execution.yaml
```

Example fragment:

```yaml
apiVersion: maestro/v1
kind: WorkspaceFragment
metadata:
  name: repositories
spec:
  repositories:
    - name: sur-api
      remote: git@github.com:org/sur-api.git
      branch: main
```

## Pack fragments

Packs can ship fragments too.
They declare those files in `spec.fragments`, and Maestro reads them from the pack's `fragments/` directory after resolving the pack.

Typical pack-fragment uses:

- add shared repository or runtime defaults;
- ship opinionated manifest overlays for a domain or toolchain;
- keep reusable pack inputs close to the pack metadata that declares them.

Example pack manifest:

```yaml
apiVersion: maestro/v1
kind: Pack
metadata:
  name: "@maestro/pack-github-actions"
  version: 0.1.0
spec:
  fragments:
    - repositories.partial.yaml
    - runtimes.partial.yaml
```

## Merge rules

Fragments are merged in order.

- Arrays are appended.
- Objects are merged recursively.
- A fragment may be written as a plain object or wrapped in `kind: WorkspaceFragment` with the useful payload under `spec`.
- Paths are resolved relative to the workspace root or the pack root and are rejected if they escape that boundary.

## When to use them

Use fragments when a manifest is getting too large, when several files need to be maintained by different people, or when a pack should contribute reusable manifest content.
Do not use fragments just to hide a configuration that should stay obvious in `maestro.yaml`.
