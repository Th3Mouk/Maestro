import { describe, expect, test } from "vitest";
import { resolveFormat } from "../../src/cli/output/format.js";

describe("resolveFormat", () => {
  test("--json wins over --format and MAESTRO_FORMAT", () => {
    expect(
      resolveFormat({ jsonFlag: true, formatFlag: "human", env: { MAESTRO_FORMAT: "human" } }),
    ).toBe("json");
  });

  test("--format wins over MAESTRO_FORMAT and the TTY default", () => {
    expect(
      resolveFormat({ formatFlag: "human", env: { MAESTRO_FORMAT: "json" }, isTTY: false }),
    ).toBe("human");
  });

  test("rejects an unsupported --format value, naming its source", () => {
    expect(() => resolveFormat({ formatFlag: "yaml" })).toThrow(
      'Invalid output format "yaml" (from --format). Supported values: human, json.',
    );
  });

  test("MAESTRO_FORMAT wins over the TTY default", () => {
    expect(resolveFormat({ env: { MAESTRO_FORMAT: "json" }, isTTY: true })).toBe("json");
  });

  test("an empty MAESTRO_FORMAT is ignored, falling through to the TTY default", () => {
    expect(resolveFormat({ env: { MAESTRO_FORMAT: "" }, isTTY: true })).toBe("human");
  });

  test("rejects an unsupported MAESTRO_FORMAT value, naming its source", () => {
    expect(() => resolveFormat({ env: { MAESTRO_FORMAT: "yaml" } })).toThrow(
      'Invalid output format "yaml" (from MAESTRO_FORMAT). Supported values: human, json.',
    );
  });

  test("defaults to human on a TTY with nothing else set", () => {
    expect(resolveFormat({ isTTY: true })).toBe("human");
  });

  test("defaults to json off a TTY with nothing else set", () => {
    expect(resolveFormat({ isTTY: false })).toBe("json");
    expect(resolveFormat({})).toBe("json");
  });
});
