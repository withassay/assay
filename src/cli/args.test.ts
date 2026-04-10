import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.js";

describe("parseCliArgs", () => {
  it("returns defaults for bare 'eval' command", () => {
    const args = parseCliArgs(["eval"]);
    expect(args).toEqual({
      command: "eval",
      config: "./assay.yaml",
      tag: undefined,
      repeat: 1,
      format: "json",
      concurrency: 1,
      dryRun: false,
      failFast: false,
      timeout: 30000,
    });
  });

  it("returns help when no command is provided", () => {
    const args = parseCliArgs([]);
    expect(args.command).toBe("help");
  });

  it("returns help with --help flag", () => {
    const args = parseCliArgs(["--help"]);
    expect(args.command).toBe("help");
  });

  it("returns help with -h flag", () => {
    const args = parseCliArgs(["-h"]);
    expect(args.command).toBe("help");
  });

  it("parses --config", () => {
    const args = parseCliArgs(["eval", "--config", "./my-agent.yaml"]);
    expect(args.config).toBe("./my-agent.yaml");
  });

  it("parses --tag", () => {
    const args = parseCliArgs(["eval", "--tag", "security"]);
    expect(args.tag).toBe("security");
  });

  it("parses --repeat", () => {
    const args = parseCliArgs(["eval", "--repeat", "5"]);
    expect(args.repeat).toBe(5);
  });

  it("parses --format json", () => {
    const args = parseCliArgs(["eval", "--format", "json"]);
    expect(args.format).toBe("json");
  });

  it("parses --format markdown", () => {
    const args = parseCliArgs(["eval", "--format", "markdown"]);
    expect(args.format).toBe("markdown");
  });

  it("parses --concurrency", () => {
    const args = parseCliArgs(["eval", "--concurrency", "8"]);
    expect(args.concurrency).toBe(8);
  });

  it("parses --dry-run", () => {
    const args = parseCliArgs(["eval", "--dry-run"]);
    expect(args.dryRun).toBe(true);
  });

  it("parses --fail-fast", () => {
    const args = parseCliArgs(["eval", "--fail-fast"]);
    expect(args.failFast).toBe(true);
  });

  it("parses --timeout", () => {
    const args = parseCliArgs(["eval", "--timeout", "5000"]);
    expect(args.timeout).toBe(5000);
  });

  it("throws on invalid --format value", () => {
    expect(() => parseCliArgs(["eval", "--format", "xml"])).toThrow('Invalid --format value "xml"');
  });

  it("throws on --repeat 0", () => {
    expect(() => parseCliArgs(["eval", "--repeat", "0"])).toThrow("--repeat must be a positive");
  });

  it("throws on zero --concurrency", () => {
    expect(() => parseCliArgs(["eval", "--concurrency", "0"])).toThrow(
      "--concurrency must be a positive",
    );
  });

  it("throws when --concurrency exceeds max", () => {
    expect(() => parseCliArgs(["eval", "--concurrency", "100"])).toThrow(
      "--concurrency must be at most 64",
    );
  });

  it("throws when --repeat exceeds max", () => {
    expect(() => parseCliArgs(["eval", "--repeat", "1001"])).toThrow(
      "--repeat must be at most 1000",
    );
  });

  it("throws on non-integer --timeout", () => {
    expect(() => parseCliArgs(["eval", "--timeout", "abc"])).toThrow(
      "--timeout must be a positive",
    );
  });

  it("throws on unknown flag", () => {
    expect(() => parseCliArgs(["eval", "--unknown"])).toThrow();
  });

  it("parses multiple flags together", () => {
    const args = parseCliArgs([
      "eval",
      "--config",
      "./agent.yaml",
      "--tag",
      "security",
      "--repeat",
      "3",
      "--format",
      "markdown",
      "--concurrency",
      "4",
      "--dry-run",
      "--fail-fast",
      "--timeout",
      "10000",
    ]);
    expect(args).toEqual({
      command: "eval",
      config: "./agent.yaml",
      tag: "security",
      repeat: 3,
      format: "markdown",
      concurrency: 4,
      dryRun: true,
      failFast: true,
      timeout: 10000,
    });
  });
});
