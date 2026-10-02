import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import {
  installShellInitBlock,
  renderShellFunction,
  supportedShells,
  uninstallShellInitBlock,
  updateShellRcFile,
} from "../../src/core/shell-init.js";
import { isExecutableOnPath } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

const syntaxCheckFlags = { zsh: ["-n"], bash: ["-n"], fish: ["--no-execute"] } as const;

describe("maestro shell-init function", () => {
  for (const shell of supportedShells) {
    test(`the ${shell} function passes ${shell} -n`, async (context) => {
      if (!(await isExecutableOnPath(shell))) {
        context.skip();
      }
      const dir = await createManagedTempDir("maestro-shell-init-");
      const file = path.join(dir, `mw.${shell}`);
      await writeFile(file, renderShellFunction(shell, "mw"), "utf8");

      const { exitCode, stderr } = await execa(shell, [...syntaxCheckFlags[shell], file], {
        reject: false,
      });

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  }

  for (const shell of ["bash", "zsh"] as const) {
    test(`in ${shell}, mw cds into the root maestro prints, and -l and --prune forward`, async (context) => {
      if (!(await isExecutableOnPath(shell))) {
        context.skip();
      }
      const dir = await createManagedTempDir("maestro-shell-run-");
      const taskRoot = path.join(dir, "worktrees", "fix login");
      await mkdir(taskRoot, { recursive: true });
      const bin = path.join(dir, "bin");
      await mkdir(bin);
      // A stand-in maestro that logs its arguments and prints the task root for `open`.
      const fakeMaestro = path.join(bin, "maestro");
      await writeFile(
        fakeMaestro,
        [
          "#!/bin/sh",
          `echo "$*" >> "${path.join(dir, "calls.log")}"`,
          `if [ "$2" = open ]; then echo "report" >&2; echo "${taskRoot}"; fi`,
        ].join("\n"),
        "utf8",
      );
      await chmod(fakeMaestro, 0o755);

      const script = [
        renderShellFunction(shell, "mw"),
        'mw "fix login" --editor none',
        "pwd",
        "mw -l",
        "mw --prune --dry-run",
      ].join("\n");
      const { stdout } = await execa(shell, ["-c", script], {
        cwd: dir,
        env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
      });

      expect(stdout.trim()).toBe(taskRoot);
      expect((await readFile(path.join(dir, "calls.log"), "utf8")).trim().split("\n")).toEqual([
        "worktree open --format human fix login --editor none",
        "worktree list --status",
        "worktree prune --dry-run",
      ]);
    });
  }
});

describe("maestro shell-init --install", () => {
  test("installing twice leaves one block and the prior content unchanged; uninstall restores the file", async () => {
    const home = await createManagedTempDir("maestro-shell-home-");
    const rcPath = path.join(home, ".zshrc");
    const original = "export EDITOR=vim\n# end of my config\n";
    await writeFile(rcPath, original, "utf8");
    const env = { HOME: home };

    const first = await updateShellRcFile("zsh", "mw", "install", env);
    const afterFirst = await readFile(rcPath, "utf8");
    const second = await updateShellRcFile("zsh", "mw", "install", env);
    const afterSecond = await readFile(rcPath, "utf8");

    expect(first).toEqual({ changed: true, path: rcPath });
    expect(second.changed).toBe(false);
    expect(afterSecond).toBe(afterFirst);
    expect(afterFirst).toBe(
      `${original}# >>> maestro shell-init >>>\neval "$(maestro shell-init zsh)"\n# <<< maestro shell-init <<<\n`,
    );

    await updateShellRcFile("zsh", "mw", "uninstall", env);
    expect(await readFile(rcPath, "utf8")).toBe(original);
  });

  test("ZDOTDIR, bash, and fish rc files", async () => {
    const home = await createManagedTempDir("maestro-shell-rc-");
    const zdotdir = path.join(home, "zsh");

    expect(
      (await updateShellRcFile("zsh", "mw", "install", { HOME: home, ZDOTDIR: zdotdir })).path,
    ).toBe(path.join(zdotdir, ".zshrc"));
    expect((await updateShellRcFile("bash", "mw", "install", { HOME: home })).path).toBe(
      path.join(home, ".bashrc"),
    );
    const fish = await updateShellRcFile("fish", "go", "install", { HOME: home });
    expect(fish.path).toBe(path.join(home, ".config", "fish", "config.fish"));
    expect(await readFile(fish.path, "utf8")).toContain(
      "maestro shell-init fish --name go | source\n",
    );
  });

  test("a re-install replaces the block in place, keeping what follows it", () => {
    const installed = installShellInitBlock("a\n", 'eval "$(maestro shell-init zsh)"');
    const withTail = `${installed}b\n`;

    const replaced = installShellInitBlock(withTail, 'eval "$(maestro shell-init zsh --name go)"');

    expect(replaced).toBe(
      'a\n# >>> maestro shell-init >>>\neval "$(maestro shell-init zsh --name go)"\n# <<< maestro shell-init <<<\nb\n',
    );
    expect(uninstallShellInitBlock(replaced)).toBe("a\nb\n");
  });
});
