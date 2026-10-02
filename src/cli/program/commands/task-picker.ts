import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import { isExecutableOnPath } from "../../../utils/fs.js";
import type { TaskRow } from "../../../core/execution-support/task-worktree-rows.js";

const header: TaskRow = {
  name: "TASK",
  repos: "REPOS",
  uncommitted: "UNCOMMITTED",
  unlanded: "UNLANDED",
  prunable: "PRUNABLE",
  age: "AGE",
};

const columns: Array<keyof TaskRow> = [
  "name",
  "repos",
  "uncommitted",
  "unlanded",
  "prunable",
  "age",
];

/** Aligned text lines, the header first. */
export function formatTaskRowLines(rows: TaskRow[]): string[] {
  const all = [header, ...rows];
  const widths = columns.map((column) => Math.max(...all.map((row) => row[column].length)));
  return all.map((row) =>
    columns
      .map((column, index) => row[column].padEnd(widths[index] ?? 0))
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
