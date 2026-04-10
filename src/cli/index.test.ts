import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";

const CLI_PATH = resolve("dist/cli/index.js");

// Create a self-contained test fixture with config + eval suite
let fixtureDir: string;
let fixtureConfig: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "assay-cli-test-"));
  const evalDir = join(fixtureDir, "evals", "test-agent");
  await mkdir(evalDir, { recursive: true });

  fixtureConfig = join(fixtureDir, "assay.yaml");
  await writeFile(
    fixtureConfig,
    stringify({
      schema_version: "1",
      agent: { id: "test-agent", name: "Test", description: "Test", version: "1.0.0" },
      invoke: { type: "command", command: "echo hello" },
      known_gaps: ["none"],
      eval_suite: "evals/test-agent",
    }),
  );
  await writeFile(
    join(evalDir, "suite.yaml"),
    stringify([
      {
        id: "case-1",
        input: "test",
        grading: [{ type: "deterministic", check: "contains", values: ["hello"] }],
      },
    ]),
  );
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

function runCli(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile("node", [CLI_PATH, ...args], { cwd }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error?.code !== undefined ? (error.code as number) : 0,
      });
    });
  });
}

describe("CLI integration", () => {
  it("prints usage with --help", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("Usage: assay");
    expect(stdout).toContain("--config");
    expect(stdout).toContain("--format");
  });

  it("prints usage with no command", async () => {
    const { stdout } = await runCli([]);
    expect(stdout).toContain("Usage: assay");
  });

  it("runs dry run with fixture config", async () => {
    const { stdout, stderr } = await runCli(["eval", "--config", fixtureConfig, "--dry-run"]);
    expect(stderr).toContain("Dry run:");
    expect(stdout).toContain('"cases_run": 0');
  });

  it("exits with error for missing config file", async () => {
    const { stderr, exitCode } = await runCli(["eval", "--config", "./nonexistent.yaml"]);
    expect(stderr).toContain("Config file not found");
    expect(exitCode).toBe(1);
  });

  it("exits with error for invalid config", async () => {
    const { stderr, exitCode } = await runCli(["eval", "--config", "./package.json"]);
    expect(stderr).toContain("Invalid agent config");
    expect(exitCode).toBe(1);
  });
});
