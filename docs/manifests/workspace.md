# Workspace Manifest

The main entry point is `maestro.yaml`.

## Supported fields

- `apiVersion`
- `kind: Workspace`
- `metadata.name`
- `metadata.description`
- `spec.framework.version`
- `spec.includes`
- `spec.runtimes`
- `spec.packs`
- `spec.repositories`
- `spec.execution`
- `spec.agents`
- `spec.skills`
- `spec.plugins`
- `spec.mcpServers`
- `spec.policies`
- `spec.conflicts`

## Repository checkout

Each `spec.repositories[]` entry may optionally define `sparse` to control how Maestro materializes the repository checkout:

- omit `sparse` to clone the repository in full;
- use `includePaths` to keep only the listed files or directories visible;
- use `excludePaths` to keep the repository visible except for the listed files or directories;
- `visiblePaths` remains accepted as a legacy alias for `includePaths`.

You can combine `includePaths` and `excludePaths` in the same repository entry. Maestro applies the inclusions first and then the exclusions, which is useful when you want a broad directory visible but need to hide a few files or nested folders inside it. Directory entries should keep the trailing `/` convention used elsewhere in the repository examples.

Examples:

```yaml
# Full clone
spec:
  repositories:
    - name: docs-site
      remote: git@github.com:org/docs-site.git
      branch: main
```

```yaml
# Include only
spec:
  repositories:
    - name: sur-api
      remote: git@github.com:org/sur-api.git
      sparse:
        includePaths:
          - .github/
          - deploy/
          - composer.json
```

```yaml
# Exclude only
spec:
  repositories:
    - name: platform
      remote: git@github.com:org/platform.git
      sparse:
        excludePaths:
          - docs/archive/
          - fixtures/
```

```yaml
# Include broad folders, then hide nested content
spec:
  repositories:
    - name: app
      remote: git@github.com:org/app.git
      sparse:
        includePaths:
          - docs/
          - src/
        excludePaths:
          - docs/Guide.md
          - src/Secret.ts
```

## Fragments

For the fragment model, layout conventions, and merge rules, see [Manifest Fragments](./fragments.md).

## Workspace authoring

Maestro keeps workspace-authored inputs, pack inputs, generated outputs, and materialized repositories separate.

- Workspace-authored inputs live in `maestro.yaml`, optional `fragments/*.yaml` fragment files, local plugin assets such as `plugins/`, and local override directories such as `overrides/agents/`, `overrides/skills/`, and `overrides/policies/`.
- The workspace root is itself the versioned workspace repository. It versions that contract and its workspace-owned files.
- `install` materializes the override tree so those local files have a stable place to live inside the workspace.
- `install` also initializes the workspace root as a Git repository when needed and materializes managed Git repositories under `repos/<name>` from the workspace manifest. Those repositories are generated from the contract; `repos/` is not the hand-authored source of truth.
- `install` initializes the workspace root as a Git repository when needed, creates the `🪄 booted by Maestro` commit when the repository is unborn, clones repositories, and projects workspace/runtime artifacts; it does not execute repository dependency bootstrap unless a workspace author runs `maestro bootstrap` afterward.
- `init` writes the workspace contract, `AGENTS.md`, `maestro.json`, and the internal `.maestro/` state root. It does not scaffold a fragment directory, a repo-local plugin marketplace, or an example repository.
- `init` defaults to Codex and Claude Code projections only; `opencode` is opt-in through `--runtimes`.
- `install` materializes generated projections only for the runtimes enabled in the manifest.
- `init` also writes `AGENTS.md`, the workspace-level Maestro CLI map for AI agents.
- `init` also writes `maestro.json`, the neutral descriptor for agents, harnesses, scripts, and other tools that consume the workspace directory directly.
- `maestro code-workspace` generates `maestro.code-workspace` on demand for editors that support named multi-root workspaces.
- `spec.agents` and `spec.skills` declare which runtime agent and skill names the workspace wants to resolve.
- `spec.plugins` declares which native runtime plugins should be enabled and, for Claude Code, which marketplaces should be exposed in `.claude/settings.json`.
- `spec.mcpServers` declares project-scoped MCP servers that Maestro projects into `.codex/config.toml` and `.mcp.json`.
- Pack-provided inputs come from `spec.packs`; packs are explicit and optional, and they can provide agents, skills, policies, templates, and hooks.
- Maestro only resolves packs that the workspace declares in the manifest. If you want shared behavior, add the packs you want there.
- Generated outputs land in `.maestro/`, `.codex/`, `.claude/`, `.opencode/`, root-level `.mcp.json`, plus root-level `AGENTS.md` and `maestro.json`.
- Generated outputs are part of the managed workspace layout. Shared-state artifacts should stay inside the workspace and follow explicit locking rules when concurrent commands can touch them.

Use the generated root file this way:

- `AGENTS.md`: the Maestro command map for AI agents operating the workspace and the runtime-specific instruction files projected for supported tools
- `maestro.json`: the canonical machine-readable description of the workspace root and managed repositories
- `maestro.code-workspace`: an optional editor entrypoint for tools that understand `.code-workspace`; generate it with `maestro code-workspace` when needed. The workspace root itself stays the canonical portable entrypoint

Workspace-local agent files are resolved from `agents/<runtime>/` when present, and workspace-local skill material is projected into `.maestro/skills/`. OpenCode is then configured through `skills.paths` to read that shared folder directly, so it does not need a second copy under `.opencode/skills/`.

Native runtime plugins stay native:

- Put installable Codex or Claude Code plugin bundles under `plugins/<plugin-name>/`.
- Put the repo-local Codex marketplace at `.agents/plugins/marketplace.json` only when you intentionally want a Codex marketplace overlay in the workspace.
- Let `spec.plugins` control activation, not plugin internals.
- Let `spec.mcpServers` control project-scoped MCP projection, not remote repository installation.

## Pack composition

Packs are declared explicitly in `spec.packs` and resolved only when a workspace asks for them.

The repository also ships example packs under [`examples/packs/`](../examples/packs/) so you can see how shared agents, skills, policies, templates, and hooks are composed for repository-specific behavior.

In practice:

- declare the packs you want in the workspace manifest;
- add broader or narrower packs for shared or repository-specific concerns;
- use workspace-local overrides when a change should stay private to one workspace.

## Execution

`spec.execution` defines how the workspace is prepared for execution support artifacts, not just for manifest resolution.

- `spec.execution.devcontainer` (optional local container artifact generation)
  - `enabled`: generates optional `.devcontainer/devcontainer.json`, `.devcontainer/Dockerfile`, and `.devcontainer/bootstrap.sh` artifacts for teams that use DevContainers locally
  - `workspaceFolder`: target path mounted inside the container
  - `remoteUser`: main user inside the container
  - `baseImage`: base image for the generated Dockerfile
- `spec.execution.worktrees`
  - `enabled`: turns on isolated task worktrees
  - `rootDir`: local root used for generated task worktrees
  - `branchPrefix`: prefix used when creating worktree branches per task and per repository

DevContainer projection is optional. Maestro uses native agent sandboxes and task-scoped worktrees for its execution path, while this manifest field controls whether the workspace also projects container files.

## Repository bootstrap

Each `spec.repositories[]` entry may also define `bootstrap`:

- `strategy: auto`: detect dependencies from the materialized repository (`composer.json`, `uv.lock`, `pyproject.toml`, `package.json`, and lockfiles)
- `strategy: manual`: run the explicit `commands` defined by the workspace
- `workingDirectory`: execute bootstrap commands from a subdirectory

Workspace authors use `bootstrap` to install dependencies after materialization. `maestro install` prepares the repositories first; `maestro bootstrap` executes the dependency step.

`spec.repositories[].branch` remains the repository reference branch used by Maestro. When omitted, Maestro resolves it to `main`. `maestro git checkout` targets that branch, while `spec.execution.worktrees.branchPrefix` only controls the names of generated task branches.

This contract feeds `maestro bootstrap` directly and can also feed the optional DevContainer bootstrap script projected by the framework.

Bootstrap execution may become more concurrent over time, but only behind explicit rate limits and shared-state protection. Performance changes must not weaken workspace safety guarantees.
