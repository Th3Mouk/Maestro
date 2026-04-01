import path from "node:path";
import YAML from "yaml";
import type { PackManifest } from "../types.js";
import { packManifestSchema } from "../schema.js";
import { readText } from "../../utils/fs.js";

export async function loadPackManifest(packRoot: string): Promise<PackManifest> {
  const manifestPath = path.join(packRoot, "pack.yaml");
  return packManifestSchema.parse(YAML.parse(await readText(manifestPath)));
}
