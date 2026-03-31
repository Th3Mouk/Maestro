import { writeFile } from "node:fs/promises";
import YAML from "yaml";

export async function writeYaml(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, YAML.stringify(data), "utf8");
}
