import deepmerge from "deepmerge";
import { normalizeFragment } from "./normalize.js";
import { parseOptionalRecord } from "./schemas.js";

export function mergeSpec(base: unknown, incoming: unknown): Record<string, unknown> {
  const normalizedBase = toRecordOrEmpty(base);
  const normalizedIncoming = normalizeFragment(incoming);
  return deepmerge<Record<string, unknown>>(normalizedBase, normalizedIncoming, {
    arrayMerge: appendArrayItems,
  });
}

function toRecordOrEmpty(value: unknown): Record<string, unknown> {
  return parseOptionalRecord(value) ?? {};
}

function appendArrayItems(target: unknown[], source: unknown[]): unknown[] {
  return [...target, ...source];
}
