import { z } from "zod";

export const unknownRecordSchema = z.record(z.string(), z.unknown());

export const fragmentSchema = z.union([unknownRecordSchema, z.array(z.unknown())]);

const fragmentWithSpecSchema = z.object({
  spec: unknownRecordSchema,
});

const workspaceIncludesSchema = z.object({
  spec: z
    .object({
      includes: z.array(z.string()).optional(),
    })
    .optional(),
});

export function parseOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = unknownRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseWorkspaceIncludes(value: Record<string, unknown>): string[] {
  const parsed = workspaceIncludesSchema.safeParse(value);
  return parsed.success ? (parsed.data.spec?.includes ?? []) : [];
}

export function parseFragmentSpec(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const parsed = fragmentWithSpecSchema.safeParse(value);
  return parsed.success ? parsed.data.spec : undefined;
}
