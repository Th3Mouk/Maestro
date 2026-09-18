import type { NameSelection } from "../schema/manifests.js";

/**
 * Turns a workspace's `spec.agents[runtime]` / `spec.skills` value into the concrete set of
 * names to resolve:
 * - `undefined` (field omitted): every available name.
 * - `string[]`: exactly those names (existing behavior).
 * - `{ exclude }`: every available name except the listed ones.
 */
export function resolveNameSelection(
  selection: NameSelection | undefined,
  availableNames: Iterable<string>,
): Set<string> {
  if (selection === undefined) {
    return new Set(availableNames);
  }

  if (Array.isArray(selection)) {
    return new Set(selection);
  }

  const excluded = new Set(selection.exclude);
  const selected = new Set<string>();
  for (const name of availableNames) {
    if (!excluded.has(name)) {
      selected.add(name);
    }
  }
  return selected;
}
