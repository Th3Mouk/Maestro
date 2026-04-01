import { fragmentSchema, parseFragmentSpec } from "./schemas.js";

export function normalizeFragment(fragment: unknown): Record<string, unknown> {
  const parsedFragment = parseFragment(fragment);
  if (isArrayFragment(parsedFragment)) {
    return {};
  }

  return parseFragmentSpec(parsedFragment) ?? parsedFragment;
}

function parseFragment(fragment: unknown): Record<string, unknown> | unknown[] {
  return fragmentSchema.parse(fragment);
}

function isArrayFragment(fragment: Record<string, unknown> | unknown[]): fragment is unknown[] {
  return Array.isArray(fragment);
}
