import YAML from "yaml";

export function parsePolicyYamlDocument(content: string): {
  name: string | undefined;
  spec: Record<string, unknown> | undefined;
} {
  const parsed = YAML.parse(content);
  if (!isRecord(parsed)) {
    return { name: undefined, spec: undefined };
  }

  const rawName = parsed["name"];
  const rawSpec = parsed["spec"];
  return {
    name: typeof rawName === "string" ? rawName : undefined,
    spec: isRecord(rawSpec) ? rawSpec : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
