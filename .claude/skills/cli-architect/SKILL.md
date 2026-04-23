---
name: cli-architect
description: Use when adding or refactoring a Maestro CLI command. Enforces the output-format-agnostic Renderer architecture and exit-code rules established in Phase 4.
version: 0.1.0
owners:
  - maestro-team
last_reviewed: 2026-04-23
---

# Goal

Keep Maestro's CLI output-format-agnostic. Every report-emitting command must render through the injected `Renderer` (human or JSON) with a stable JSON envelope, a consistent exit-code mapping, and progress logged to stderr. This skill is the checklist to hit every time a new command is added or an existing one is refactored.

# Scope

**In scope:**
- Adding a new report-emitting command (`workspace *`, `repo *`, `worktree *`, `editor-workspace`).
- Refactoring an existing command that still calls `console.log` or `process.stdout.write` directly.
- Introducing a new report shape that needs a human formatter.

**Out of scope:**
- Framework-agnostic SOLID/DI guidance — covered by the home-directory cli-architect skill at `~/.claude/skills/cli-architect/SKILL.md`.
- Domain logic or manifest schema changes.
- Test infrastructure.

# Architecture invariants

These are enforced on every PR that touches `src/cli/`:

1. **No direct stdout writes in command actions.** `.action()` callbacks must not call `console.log`, `console.error`, or `process.stdout.write`. All output goes through the injected `Renderer` (see `src/cli/output/renderer.ts`).
2. **Domain services return typed `Report` objects.** Services under `src/core/commands/**` do not know about the output format. They return a typed report with `status: ReportStatus` and, where applicable, an `issues` array.
3. **Format selection lives in the composition root.** `runReportAction` in `src/cli/program/commands/command-helpers.ts` calls `resolveFormat` and `createRenderer` to pick `human` vs `json`. Commands never make that decision themselves.
4. **Exit codes go through `statusToExitCode`.** Defined in `src/cli/exit-codes.ts`. Never hand-roll exit-code logic. `ok` and `warning` → 0; `error` → 1.
5. **Progress and logs go to stderr.** Not stdout. JSON consumers must be able to `| jq '.data'` without interference.

# How to add a new report-emitting command

Follow these steps in order; each builds on the previous.

1. **Define the report type.**
   - Add an interface to `src/report/types.ts` with a `status: ReportStatus` field.
   - If the command surfaces per-item results, add an `issues` array of a typed issue shape.
   - Keep the type serializable (no class instances, functions, or cyclic refs).

2. **Implement the domain service.**
   - Place it under `src/core/commands/<group>/<command>.ts`.
   - Return the typed report. Do not log, print, or set `process.exitCode`.
   - Throw typed errors for failure paths that should produce a known `ErrorCode`.

3. **Register the command.**
   - Create the registration file under `src/cli/program/commands/`.
   - Apply shared options: `addWorkspaceAndDryRunOptions(cmd)` and `addOutputOptions(cmd)` from `src/cli/program/shared-options.ts`. Do not re-declare `--workspace`, `--dry-run`, `--format`, `--json`, or `--no-color` inline.
   - In `.action()`, call:
     ```ts
     await runReportAction(options, "<reportKind>", async () => yourService(...));
     ```

4. **Wire the human formatter.**
   - Add the new `reportKind` string literal to the `HumanReportKind` union.
   - Create a formatter file at `src/cli/output/human/<kind>.ts` that takes the report and a color-aware writer, and returns a string (or writes lines via the passed writer).
   - Register the formatter in the dispatch in `src/cli/output/human/human-renderer.ts`.

5. **Test.**
   - Add one unit test for the human formatter with color disabled for deterministic output.
   - The service's existing tests already cover the JSON path because the envelope is applied uniformly by `createRenderer`.

# Flag surface conventions

- Standard options: always use `addWorkspaceAndDryRunOptions` and `addOutputOptions`. Never re-declare these inline.
- Custom options (e.g. `--repository`, `--task`) go on the specific command, after the shared helpers.
- Error handling: let the service throw typed errors that map to an `ErrorCode`. The composition root (`runReportAction`) wraps untyped throws as `UNEXPECTED`. Do not catch errors inside `.action()` just to format them — that bypasses the renderer.

# Acceptance criteria

A reviewer should be able to confirm all of the following:

- [ ] `grep -rn "process\.stdout\.write\|console\.log" src/cli/program/commands/` returns **no hits** inside `.action()` bodies.
- [ ] The new command is registered with both `addWorkspaceAndDryRunOptions` and `addOutputOptions` (or a documented reason if not).
- [ ] Every new report type has a matching human formatter entry in `human-renderer.ts`. The JSON path is automatic via the envelope.
- [ ] `process.exitCode` is set exclusively by `runReportAction` / `statusToExitCode`; no ad-hoc `process.exit(n)` or `process.exitCode = n` in the command.
- [ ] JSON stdout matches `{data, schemaVersion: 1}`.
- [ ] Error stderr matches `{error: {code, message, details?}, schemaVersion: 1}` with `code` from the `ErrorCode` union in `src/cli/output/renderer.ts`.
- [ ] Progress/logs emitted by the service go to stderr, not stdout.

# References

- `src/cli/output/renderer.ts` — `Renderer` interface, `ErrorCode` union, `SCHEMA_VERSION`.
- `src/cli/output/human/human-renderer.ts` — human dispatch map.
- `src/cli/program/commands/command-helpers.ts` — `runReportAction`, the single place that orchestrates format resolution, rendering, and exit-code mapping.
- `src/cli/program/shared-options.ts` — `addWorkspaceAndDryRunOptions`, `addOutputOptions`.
- `src/cli/exit-codes.ts` — `statusToExitCode`.
- `docs/cli/commands.md#output-formats` — user-facing spec of the envelope, precedence, and error codes.
- `~/.claude/skills/cli-architect/SKILL.md` — framework-agnostic SOLID/DI guidance. This project skill is Maestro-specific; the home skill covers the broader pattern (interfaces, factories, dry-run substitution) in a framework-agnostic way.
