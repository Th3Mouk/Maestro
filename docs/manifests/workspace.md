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
- `spec.workflows`
- `spec.plugins`
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
          - composer.lock
```

If a repository uses `bootstrap.strategy: auto`, keep the relevant lockfile visible in sparse checkouts. For example, include `composer.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, or `uv.lock` alongside the manifest file that triggers auto detection.

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

- Workspace-authored inputs live in `maestro.yaml`, optional `fragments/*.yaml` fragment files, `skills/`, `agents/<runtime>/`, `workflows/`, local plugin assets such as `plugins/`, and local override directories such as `overrides/agents/<runtime>/`, `overrides/skills/`, `overrides/workflows/`, `overrides/templates/`, and `overrides/policies/`.
- The workspace root is itself the versioned workspace repository. It versions that contract and its workspace-owned files.
- `workspace install` initializes the workspace root as a Git repository when needed, creates the `🪄 booted by Maestro` commit when the repository is unborn, materializes managed Git repositories under `repos/<name>`, and projects runtime artifacts. Those repositories are generated from the contract; `repos/` is not the hand-authored source of truth. It does not execute repository dependency bootstrap unless a workspace author runs `maestro repo bootstrap` afterward.
- `init` writes the workspace contract, `AGENTS.md`, `maestro.json`, `.gitignore`, and the internal `.maestro/` state root. It does not scaffold a fragment directory, a repo-local plugin marketplace, or an example repository, and it never writes `CLAUDE.md`.
- `init` enables the `standard` and `claude-code` runtimes by default; `--runtimes` accepts any runtime listed in [Supported runtimes](#supported-runtimes).
- `maestro editor-workspace` generates `maestro.code-workspace` on demand for editors that support named multi-root workspaces.
- Pack-provided inputs come from `spec.packs`; packs are explicit and optional, and they can provide agents, skills, workflows, policies, templates, and install/validate hooks.
- Maestro only resolves packs that the workspace declares in the manifest. If you want shared behavior, add the packs you want there.
- Generated outputs are part of the managed workspace layout. Shared-state artifacts should stay inside the workspace and follow explicit locking rules when concurrent commands can touch them.

Use the generated root files this way:

- `AGENTS.md`: the Maestro command map for AI agents operating the workspace. `init` writes it once; a pack template or `overrides/templates/AGENTS.md` replaces it on every install.
- `maestro.json`: the canonical machine-readable description of the workspace root and managed repositories.
- `maestro.code-workspace`: an optional editor entrypoint for tools that understand `.code-workspace`; generate it with `maestro editor-workspace` when needed. The workspace root itself stays the canonical portable entrypoint.

## Runtime projection

Maestro converges on the shared conventions coding agents already agree on, and only projects where they still diverge:

- **Instructions** follow [`AGENTS.md`](https://agents.md/). Codex, Cursor, Copilot, OpenCode, Kilo Code, Devin, and Claude Code (v2.1.277 or later) all read it, so Maestro writes one `AGENTS.md` and no per-tool instruction file.
- **Skills** follow the [Agent Skills](https://agentskills.io/specification) format. Every supported tool scans `.agents/skills/` except Claude Code, which only scans `.claude/skills/`. Maestro therefore fills both.
- **Subagents** have no shared format. Each tool reads its own directory and frontmatter, so agents stay authored per runtime under `agents/<runtime>/` and are projected to that runtime's directory unchanged.
- **Workflows** exist only in Claude Code (`.claude/workflows/`).
- **MCP servers, hooks, and runtime settings** are left to each tool's own configuration files. See [What Maestro does not manage](#what-maestro-does-not-manage).

### Canonical layout

This is what Maestro produces when `spec.runtimes` is omitted. Everything below is also the default of each option described in [Configuring projections](#configuring-projections).

```text
my-workspace/
├── maestro.yaml
├── AGENTS.md                    # instructions for every tool; written by `init`
├── skills/<name>/SKILL.md       # authored skills (Agent Skills format)
├── agents/<runtime>/<name>.*    # authored subagents, one folder per runtime format
├── workflows/<name>.js          # authored Claude Code workflow scripts
├── overrides/                   # workspace-local replacements for pack content
│
├── .agents/skills/<name>/       # generated: real copy, read by Codex, Cursor, Copilot, Gemini CLI, OpenCode, Kilo Code, Devin
├── .claude/skills/<name>        # generated: symlink to ../../.agents/skills/<name>
├── .claude/workflows/<name>.js  # generated: real file
└── .maestro/                    # state, lockfile, reports, the canonical skill copy, task worktrees
```

Agents are not projected by default: add `agents` to a runtime to turn it on (see [Agents](#agents)).

The generated directories are added to `.gitignore`, and only for the projections that are active. Instruction files, `.claude/settings.json`, `.mcp.json`, hook files, and any other runtime configuration stay versionable.

Because projected directories are regenerated, keep the source of anything you want versioned under `skills/`, `agents/<runtime>/`, or `workflows/`. A workflow saved from Claude Code's `/workflows` dialog lands in `.claude/workflows/`; move it to `workflows/` to keep it.

### Instruction files: `AGENTS.md` and `CLAUDE.md`

Maestro writes `AGENTS.md` and never creates, edits, or deletes `CLAUDE.md`. Whether a workspace keeps a `CLAUDE.md`, and whether it is versioned, is the team's decision.

Claude Code reads `AGENTS.md` as project instructions only when no `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists in the working directory or above it. The main options are:

- **No `CLAUDE.md`**: Claude Code v2.1.277 and later reads `AGENTS.md` directly.
- **A `CLAUDE.md` that starts with `@AGENTS.md`**: Claude Code imports `AGENTS.md` and then reads your Claude-specific additions. This also works on older versions and in sessions where direct `AGENTS.md` loading is unavailable.
- **Both files loaded side by side**: set the user-level **Project instructions** setting to `claude-md-and-agents-md`. This setting is ignored in project settings, so a workspace cannot impose it.

Anthropic documents the consequences of each choice, including the sessions that cannot read `AGENTS.md` directly and the few behaviors that differ from `CLAUDE.md`, in [How Claude remembers your project — AGENTS.md](https://code.claude.com/docs/en/memory#agents-md).

Workspaces created with Maestro 0.5 or earlier contain a generated `CLAUDE.md` that starts with `<!-- Generated by Maestro.`. It hides `AGENTS.md` from Claude Code. `maestro workspace doctor` reports it as `LEGACY_GENERATED_CLAUDE_MD`; delete the file or replace its content with `@AGENTS.md`.

<a id="two-runtimes-standard-and-claude-code"></a>

### Supported runtimes

| Runtime key   | Skills target     | Agents target                    | Workflows target     |
| ------------- | ----------------- | -------------------------------- | -------------------- |
| `standard`    | `.agents/skills/` | `.agents/agents/<name>.md`       | —                    |
| `claude-code` | `.claude/skills/` | `.claude/agents/<name>.md`       | `.claude/workflows/` |
| `codex`       | —                 | `.codex/agents/<name>.toml`      | —                    |
| `cursor`      | —                 | `.cursor/agents/<name>.md`       | —                    |
| `copilot`     | —                 | `.github/agents/<name>.agent.md` | —                    |
| `gemini`      | —                 | `.gemini/agents/<name>.md`       | —                    |
| `opencode`    | —                 | `.opencode/agents/<name>.md`     | —                    |
| `kilo`        | —                 | `.kilo/agents/<name>.md`         | —                    |
| `devin`       | —                 | `.devin/agents/<name>.md`        | —                    |

Runtimes without a skills target read `.agents/skills/` themselves, so enable `standard` for them.

### Configuring projections

Each key under `spec.runtimes` turns on one runtime. Inside it:

| Field             | Applies to                | Values                                   | Default                                     |
| ----------------- | ------------------------- | ---------------------------------------- | ------------------------------------------- |
| `enabled`         | every runtime             | `true`, `false`                          | `true`                                      |
| `projectionMode`  | every runtime             | `merge`, `replace`                       | `merge`; default `mode` of the assets below |
| `skills`          | `standard`, `claude-code` | `true`, `false`, or `{ mode, strategy }` | on                                          |
| `skills.strategy` | `claude-code`             | `symlink`, `copy`                        | `symlink`                                   |
| `agents`          | every runtime             | `true`, `false`, or `{ mode }`           | **off**                                     |
| `workflows`       | `claude-code`             | `true`, `false`, or `{ mode }`           | on                                          |

`true` and `{}` turn an asset on with its defaults; `false` turns it off. An asset `mode` overrides the runtime's `projectionMode`.

How `spec.runtimes` itself resolves:

- **Omitted**: the canonical layout, identical to `standard: {}` plus `claude-code: {}`. Runtimes contributed by a pack fragment are merged on top of it; a workspace-local `fragments/runtimes.yaml` counts as declaring `spec.runtimes`.
- **`{}`**: no runtime is projected.
- **Any runtime listed**: only the listed runtimes are projected; the canonical defaults no longer apply to the others.

```yaml
spec:
  runtimes:
    standard: {} # .agents/skills/
    claude-code:
      agents: {} # .claude/agents/
      workflows:
        mode: replace # .claude/workflows/ is fully regenerated
    codex:
      agents: {} # .codex/agents/*.toml
    copilot:
      agents:
        mode: replace # .github/agents/ is fully regenerated
```

`skills.strategy: symlink` links `.claude/skills/<name>` to `.agents/skills/<name>` so both runtimes read one tree. Maestro falls back to a real copy when `standard` does not project skills (the link target would not exist) and on Windows (directory symlinks need Developer Mode or elevated rights there). Set `strategy: copy` to always get a real directory.

### Projection mode: `merge` or `replace`

`mode` controls how `workspace install`/`update` treats content already sitting in a target directory. It applies the same way to skills, agents, and workflows:

- **`merge`** (the default) touches only the names Maestro is about to project. Matching entries are overwritten; everything else in the directory — a hand-written agent, a skill installed by another tool, a workflow saved from Claude Code, an entry you have since removed from the selection — is left alone.
- **`replace`** deletes the whole target directory before projecting, then writes only the current selection. Use it when you want no drift and no leftovers.

To stop projecting an asset, set it to `false`. Maestro then leaves its directory as it is; delete it by hand if you no longer want it.

<a id="selecting-agents-and-skills"></a>

### Selecting agents, skills, and workflows

`spec.agents.<runtime>`, `spec.skills`, and `spec.workflows` each accept one of three shapes:

- Omitted entirely: selects every entry Maestro can find — workspace-local files under `agents/<runtime>/`, `skills/`, or `workflows/`, plus anything packs provide.
- A list of names, e.g. `["planner", "repo-auditor"]`: selects exactly those names. Pack-provided entries are still added on top of the list, so a workspace can't use this form to shrink what a pack provides.
- `{ exclude: [...] }`: selects everything from the same pool as the omitted case except the listed names. Unlike the plain list form, `exclude` can drop a pack-provided name.

```yaml
spec:
  agents:
    claude-code:
      exclude:
        - internal-only-agent # everything else under agents/claude-code/, plus pack-provided agents
    codex:
      - planner # only planner, plus whatever packs provide
  skills:
    exclude:
      - draft-skill
  workflows:
    - release-audit
```

An explicit empty list (`skills: []`) means "select nothing" — different from omitting the field, which means "select everything".

Selection and projection are independent: `spec.agents.codex` picks which Codex agents exist, while `spec.runtimes.codex.agents` decides whether they are written to `.codex/agents/`.

Each name resolves in this order: `overrides/<kind>/…`, then the workspace-local folder, then the declared packs. A selected skill or workflow that none of them defines fails the install. A selected agent that none of them defines is written as a minimal placeholder in the runtime's format.

### Agents

Subagent definitions are not portable between tools, so Maestro never converts them. Write each agent in the format of the runtime that will run it, under `agents/<runtime>/`, and Maestro copies it to the runtime's directory unchanged. The same applies to `overrides/agents/<runtime>/` and to a pack's `agents/<runtime>/`.

| Runtime key   | Author in                                       | Format and required fields                                                                                                                                                                                                    | Reference                                                                                                                                                                                          |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code` | `agents/claude-code/<name>.md`                  | Markdown with YAML frontmatter. `name` and `description` are required; the body is the system prompt. Optional fields include `tools`, `model`, `permissionMode`, `skills`, and `effort`.                                     | [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)                                                                                                                                |
| `codex`       | `agents/codex/<name>.toml`                      | TOML. `name`, `description`, and `developer_instructions` are required. Optional fields include `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `skills.config`.                                        | [Codex subagents](https://developers.openai.com/codex/subagents)                                                                                                                                   |
| `cursor`      | `agents/cursor/<name>.md`                       | Markdown with YAML frontmatter; every field is optional (`name`, `description`, `model` as `inherit` or a model id, `readonly`, `is_background`). Cursor also reads `.claude/agents/`.                                        | [Cursor subagents](https://cursor.com/docs/context/subagents)                                                                                                                                      |
| `copilot`     | `agents/copilot/<name>.md` or `<name>.agent.md` | Markdown with YAML frontmatter, written as `<name>.agent.md`. `description` is required by the cloud agent; optional fields include `name`, `tools`, `model`, `handoffs`, and `target`. VS Code also reads `.claude/agents/`. | [VS Code custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents), [Copilot custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration) |
| `gemini`      | `agents/gemini/<name>.md`                       | Markdown with YAML frontmatter. `name` and `description` are required; optional fields include `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, and `timeout_mins`.                                                | [Gemini CLI subagents](https://geminicli.com/docs/core/subagents/)                                                                                                                                 |
| `opencode`    | `agents/opencode/<name>.md`                     | Markdown with YAML frontmatter. `description` is required; `mode` (`primary`, `subagent`, `all`), `model` as `provider/model`, and a `permission` map are optional.                                                           | [OpenCode agents](https://opencode.ai/docs/agents/)                                                                                                                                                |
| `kilo`        | `agents/kilo/<name>.md`                         | Markdown with YAML frontmatter, same shape as OpenCode: `description`, `mode`, `model`, `permission`.                                                                                                                         | [Kilo Code subagents](https://kilo.ai/docs/customize/custom-subagents)                                                                                                                             |
| `devin`       | `agents/devin/<name>.md`                        | Markdown with YAML frontmatter: `name`, `description`, `model`, `allowed-tools`.                                                                                                                                              | [Devin subagents](https://docs.devin.ai/cli/subagents)                                                                                                                                             |
| `standard`    | `agents/standard/<name>.md`                     | Markdown projected into the shared `.agents/agents/` directory. Only Devin reads that directory today; there is no cross-tool subagent standard.                                                                              | —                                                                                                                                                                                                  |

Because Cursor and VS Code also read `.claude/agents/`, enabling `claude-code` agents alongside `cursor` or `copilot` agents can show the same agent twice in those tools.

### Workflows

Claude Code [workflows](https://code.claude.com/docs/en/workflows) are JavaScript scripts that orchestrate subagents. No other tool has an equivalent, so they only project for `claude-code`.

- Author them as `workflows/<name>.js`; a pack ships them as `workflows/<name>.js` and lists them under `spec.provides.workflows`; `overrides/workflows/<name>.js` replaces either.
- Maestro writes real files into `.claude/workflows/`, never symlinks: Claude Code refuses to save a project workflow through a symlinked path.
- Each file runs as `/<name>` in Claude Code.

Set `workflows: false` on `claude-code` to stop projecting them.

### What Maestro does not manage

Maestro prepares the workspace; each tool keeps its own configuration. Maestro does not generate, merge, or validate:

- **MCP servers**: configure them in each tool's file, for example `.mcp.json` for Claude Code ([docs](https://code.claude.com/docs/en/mcp)), `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, or `opencode.json`. `spec.mcpServers` is no longer read.
- **Hooks**: configure them in each tool's settings, for example `.claude/settings.json` for Claude Code ([docs](https://code.claude.com/docs/en/hooks)), `.cursor/hooks.json`, `.github/hooks/`, or `.gemini/settings.json`. Pack `hooks.install` and `hooks.validate` are Maestro lifecycle scripts, not tool hooks, and keep working.
- **Instruction files other than `AGENTS.md`**, such as `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, or `.github/copilot-instructions.md`.
- **Runtime settings and permissions**.

These files are not added to `.gitignore`, so teams can version them in the workspace repository.

### Plugins

- Put installable plugin bundles under `plugins/<plugin-name>/`.
- Put a repo-local plugin marketplace at `.agents/plugins/marketplace.json` only when you intentionally want a marketplace overlay in the workspace; `maestro doctor` validates that any locally-sourced plugin it references carries a native `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json` manifest. Projection never touches `.agents/plugins/`.
- `spec.plugins["claude-code"]` controls Claude Code plugin activation (`enabled`) and marketplaces (`marketplaces`), not plugin internals. When either is set, Maestro merges `enabledPlugins` and `extraKnownMarketplaces` into `.claude/settings.json` and leaves every other key in that file untouched.

## Pack composition

Packs are declared explicitly in `spec.packs` and resolved only when a workspace asks for them.

The repository also ships example packs under [`examples/packs/`](../examples/packs/) so you can see how shared agents, skills, workflows, policies, templates, and install/validate hooks are composed for repository-specific behavior.

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

Workspace authors use `bootstrap` to install or sync dependencies after materialization. `maestro workspace install` prepares the repositories first; `maestro repo bootstrap` executes the dependency step.

`maestro repo bootstrap` is not a package upgrade abstraction. In `auto` mode it maps the detected repository files to the native install command for that toolchain:

- Composer repositories run `composer install --no-interaction --prefer-dist`.
- uv repositories run `uv sync`.
- npm repositories with `package-lock.json` run `npm ci`.
- pnpm repositories with `pnpm-lock.yaml` run `pnpm install --frozen-lockfile`.
- Yarn repositories with `yarn.lock` run `yarn install --immutable`.
- Bun repositories with `bun.lock` or `bun.lockb` run `bun install`.

When the manifest exists but the expected lockfile is missing, Maestro reports a warning for that repository instead of falling back to a command that would resolve and rewrite dependencies.

Use `maestro repo bootstrap --workspace <path> --dry-run` when maintainers need to verify the exact commands before execution.

`spec.repositories[].branch` remains the repository reference branch used by Maestro. When omitted, Maestro resolves it to `main`. `maestro repo git checkout` targets that branch, while `spec.execution.worktrees.branchPrefix` only controls the names of generated task branches.

This contract feeds `maestro repo bootstrap` directly and can also feed the optional DevContainer bootstrap script projected by the framework.

Bootstrap execution may become more concurrent over time, but only behind explicit rate limits and shared-state protection. Performance changes must not weaken workspace safety guarantees.
