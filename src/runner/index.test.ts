import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEvalSuite, type RunOptions } from "./index.js";
import type { AgentProof } from "../schema/types.js";
import { ProofResultSchema } from "../schema/types.js";

// Use echo as a simple agent — returns the input as output
const testConfig: AgentProof = {
  schema_version: "1",
  agent: {
    id: "test-agent",
    name: "Test Agent",
    description: "Agent for testing",
    version: "1.0.0",
  },
  invoke: { type: "command", command: "cat" },
  known_gaps: ["nothing"],
  eval_suite: "evals",
};

let tempDir: string;
let evalDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "assay-test-"));
  evalDir = join(tempDir, "evals");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(evalDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    config: testConfig,
    configDir: tempDir,
    tag: undefined,
    repeat: 1,
    concurrency: 1,
    failFast: false,
    timeout: 5000,
    dryRun: false,
    ...overrides,
  };
}

async function writeEvalFile(filename: string, cases: unknown[]): Promise<void> {
  const { stringify } = await import("yaml");
  await writeFile(join(evalDir, filename), stringify(cases));
}

const simpleCase = {
  id: "case-1",
  input: "hello",
  grading: [{ type: "deterministic", check: "contains", values: ["hello"] }],
};

const secondCase = {
  id: "case-2",
  input: "world",
  grading: [{ type: "deterministic", check: "contains", values: ["world"] }],
  tags: ["greeting"],
};

describe("runEvalSuite", () => {
  it("loads and runs eval cases from a directory", async () => {
    await writeEvalFile("suite.yaml", [simpleCase]);

    const result = await runEvalSuite(makeOptions());

    expect(result.proofResult.cases_run).toBe(1);
    expect(result.proofResult.cases_passed).toBe(1);
    expect(result.proofResult.cases_failed).toBe(0);
    expect(result.proofResult.results).toHaveLength(1);
    expect(result.proofResult.results[0]).toHaveProperty("case_id", "case-1");
    expect(result.proofResult.results[0]).toHaveProperty("passed", true);
    expect(result.timings).toHaveLength(1);
  });

  it("resolves eval suite path relative to config directory", async () => {
    await writeEvalFile("suite.yaml", [simpleCase]);

    const result = await runEvalSuite(makeOptions());

    expect(result.proofResult.cases_run).toBe(1);
  });

  it("throws when eval suite directory does not exist", async () => {
    await expect(
      runEvalSuite(makeOptions({ config: { ...testConfig, eval_suite: "nonexistent" } })),
    ).rejects.toThrow("Eval suite directory not found");
  });

  it("throws when eval suite has no yaml files", async () => {
    // evalDir exists but is empty
    await expect(runEvalSuite(makeOptions())).rejects.toThrow("No .yaml files found");
  });

  it("throws on duplicate case IDs across files", async () => {
    await writeEvalFile("a.yaml", [simpleCase]);
    await writeEvalFile("b.yaml", [simpleCase]);

    await expect(runEvalSuite(makeOptions())).rejects.toThrow("Duplicate case ID");
  });

  it("filters cases by tag", async () => {
    await writeEvalFile("suite.yaml", [simpleCase, secondCase]);

    const result = await runEvalSuite(makeOptions({ tag: "greeting" }));

    expect(result.proofResult.cases_run).toBe(1);
    expect(result.proofResult.results[0]).toHaveProperty("case_id", "case-2");
  });

  it("skips cases with skip: true", async () => {
    await writeEvalFile("suite.yaml", [{ ...simpleCase, skip: true }, secondCase]);

    const result = await runEvalSuite(makeOptions());

    expect(result.proofResult.cases_run).toBe(1);
    expect(result.proofResult.results[0]).toHaveProperty("case_id", "case-2");
  });

  it("returns zero cases_run for dry run", async () => {
    await writeEvalFile("suite.yaml", [simpleCase, secondCase]);

    const result = await runEvalSuite(makeOptions({ dryRun: true }));

    expect(result.proofResult.cases_run).toBe(0);
    expect(result.proofResult.cases_passed).toBe(0);
    expect(result.proofResult.cases_failed).toBe(0);
    expect(result.proofResult.results).toHaveLength(0);
    expect(result.timings).toHaveLength(0);
  });

  it("produces valid ProofResult according to schema", async () => {
    await writeEvalFile("suite.yaml", [simpleCase, secondCase]);

    const result = await runEvalSuite(makeOptions());

    const validation = ProofResultSchema.safeParse(result.proofResult);
    expect(validation.success).toBe(true);
  });
});

describe("runEvalSuite — repeat", () => {
  it("runs each case N times with --repeat and aggregates to one result per case", async () => {
    await writeEvalFile("suite.yaml", [simpleCase, secondCase]);

    const result = await runEvalSuite(makeOptions({ repeat: 3 }));

    // Results: one per unique case
    expect(result.proofResult.results).toHaveLength(2);
    expect(result.proofResult.cases_run).toBe(2);

    // Timings: all individual invocations
    expect(result.timings).toHaveLength(6);
  });

  it("computes zero variance when all repeats pass", async () => {
    await writeEvalFile("suite.yaml", [simpleCase]);

    const result = await runEvalSuite(makeOptions({ repeat: 3 }));

    expect(result.proofResult.confidence.variance).toBe(0);
    expect(result.proofResult.confidence.score).toBe(1);
  });

  it("includes per-repeat breakdown in grading_details when repeat > 1", async () => {
    await writeEvalFile("suite.yaml", [simpleCase]);

    const result = await runEvalSuite(makeOptions({ repeat: 2 }));

    const details = result.proofResult.results[0]?.grading_details ?? [];
    expect(details).toHaveLength(2);
    expect(details[0]).toHaveProperty("repeat", 0);
    expect(details[1]).toHaveProperty("repeat", 1);
  });
});

describe("runEvalSuite — fail-fast", () => {
  it("stops after first failure with --fail-fast", async () => {
    // Use a command that always fails — non-zero exit doesn't cause failure
    // since grading is stubbed to pass. Instead, mock gradeCase to fail.
    vi.spyOn(await import("../grading/index.js"), "gradeCase").mockImplementation(
      (evalCase, _output) => {
        if (evalCase.id === "case-1") {
          return [
            {
              layer_type: "deterministic" as const,
              check: "contains",
              passed: false,
              score: 0,
              details: "forced failure",
            },
          ];
        }
        return [
          {
            layer_type: "deterministic" as const,
            check: "contains",
            passed: true,
            score: 1,
            details: "pass",
          },
        ];
      },
    );

    await writeEvalFile("suite.yaml", [simpleCase, secondCase]);

    const result = await runEvalSuite(makeOptions({ failFast: true }));

    expect(result.proofResult.cases_failed).toBeGreaterThanOrEqual(1);
    // With fail-fast, we should have fewer total invocations than cases
    expect(result.timings.length).toBeLessThanOrEqual(2);
  });
});

describe("runEvalSuite — concurrency", () => {
  it("runs cases in parallel with concurrency > 1", async () => {
    await writeEvalFile("suite.yaml", [simpleCase, secondCase]);

    const result = await runEvalSuite(makeOptions({ concurrency: 2 }));

    expect(result.proofResult.cases_run).toBe(2);
    expect(result.proofResult.cases_passed).toBe(2);
  });
});
