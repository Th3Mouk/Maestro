import { rm } from "node:fs/promises";
import { onTestFinished } from "vitest";
import { createTempDir } from "../../src/utils/fs.js";

export async function createManagedTempDir(prefix: string): Promise<string> {
  const root = await createTempDir(prefix);
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
