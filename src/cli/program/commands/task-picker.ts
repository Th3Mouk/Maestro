import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import { isExecutableOnPath } from "../../../utils/fs.js";
import type { TaskRow } from "../../../core/execution-support/task-worktree-rows.js";

/** Aligned text lines, the header first; `listColumns` values follow the built-in columns. */
export function formatTaskRowLines(rows: TaskRow[]): string[] {
  const extraNames = [...new Set(rows.flatMap((row) => Object.keys(row.extra)))];
  const table = [
    [
      "TASK",
      "REPOS",
      "UNCOMMITTED",
      "UNLANDED",
      "PRUNABLE",
      "AGE",
      ...extraNames.map((name) => name.toUpperCase()),
    ],
    ...rows.map((row) => [
      row.name,
      row.repos,
      row.uncommitted,
      row.unlanded,
      row.prunable,
      row.age,
      ...extraNames.map((name) => row.extra[name] ?? "-"),
    ]),
  ];
  const widths =
    table[0]?.map((_, column) => Math.max(...table.map((cells) => cells[column]?.length ?? 0))) ??
    [];
  return table.map((cells) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

interface PickerIo {
  env: NodeJS.ProcessEnv;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/**
 * Lets the user choose a task: with `fzf` when it is on PATH, otherwise from a numbered
 * menu written to stderr. Returns the task name, or `undefined` when nothing is chosen.
 */
export async function pickTask(
  rows: TaskRow[],
  io: PickerIo = { env: process.env, input: process.stdin, output: process.stderr },
): Promise<string | undefined> {
  const lines = formatTaskRowLines(rows);
  if (await isExecutableOnPath("fzf", io.env)) {
    // fzf draws on /dev/tty itself and prints the chosen line on stdout. Each line carries
    // its row index in a hidden first field, since task names may contain spaces.
    const { exitCode, stdout } = await execa(
      "fzf",
      [
        "--header-lines=1",
        "--no-multi",
        "--delimiter=\t",
        "--with-nth=2..",
        "--prompt=task> ",
        "--layout=reverse",
      ],
      {
        input: lines.map((line, index) => `${index}\t${line}`).join("\n"),
        reject: false,
        stderr: "inherit",
      },
    );
    const index = Number.parseInt(stdout.split("\t")[0] ?? "", 10);
    return exitCode === 0 && index > 0 ? rows[index - 1]?.name : undefined;
  }
  return pickFromMenu(rows, lines, io);
}

async function pickFromMenu(
  rows: TaskRow[],
  lines: string[],
  io: PickerIo,
): Promise<string | undefined> {
  const [headerLine, ...rowLines] = lines;
  io.output.write(`    ${headerLine}\n`);
  rowLines.forEach((line, index) => {
    io.output.write(`${String(index + 1).padStart(3)} ${line}\n`);
  });

  const prompt = createInterface({ input: io.input, output: io.output, terminal: false });
  try {
    io.output.write("task number or name: ");
    const answer = (await prompt.question("")).trim();
    if (!answer) {
      return undefined;
    }
    const index = Number.parseInt(answer, 10);
    if (String(index) === answer) {
      return rows[index - 1]?.name;
    }
    return rows.find((row) => row.name === answer)?.name;
  } finally {
    prompt.close();
  }
}
