import { describe, it, expect } from "vitest";
import { stringify } from "yaml";
import { validateAgentProof, validateEvalSuite, validateProofResult } from "./validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentProof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "1",
    agent: {
      id: "code-reviewer",
      name: "Code Reviewer",
      description: "Reviews code for security issues",
      version: "1.0.0",
    },
    invoke: { type: "command", command: "npx code-review" },
    known_gaps: ["performance analysis"],
    eval_suite: "evals/code-reviewer",
    ...overrides,
  };
}

function makeEvalCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sql-injection-01",
    input: "SELECT * FROM users WHERE id = $1",
    expected: { must_contain: ["parameterized"] },
    grading: [{ type: "deterministic", check: "contains", values: ["parameterized"] }],
    tags: ["security"],
    ...overrides,
  };
}

function makeProofResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "1",
    agent_id: "code-reviewer",
    run_id: "run-001",
    timestamp: "2026-04-08T12:00:00Z",
    cases_run: 5,
    cases_passed: 4,
    cases_failed: 1,
    confidence: {
      score: 0.8,
      maturity: "emerging",
      case_count: 5,
      variance: 0.1,
    },
    known_gaps: ["performance"],
    not_checked: ["accessibility"],
    run_metadata: {
      model: "claude-sonnet-4-20250514",
      invoke_type: "command",
      duration_ms: 12000,
    },
    results: [
      {
        case_id: "sql-injection-01",
        passed: true,
        output: "Found parameterized query",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Agent proof — happy path
// ---------------------------------------------------------------------------

describe("validateAgentProof", () => {
  it("accepts valid agent proof with command invoke", () => {
    const result = validateAgentProof(stringify(makeAgentProof()));
    expect(result.success).toBe(true);
  });

  it("accepts valid agent proof with http invoke", () => {
    const result = validateAgentProof(
      stringify(
        makeAgentProof({
          invoke: { type: "http", http: "https://api.example.com/review" },
        }),
      ),
    );
    expect(result.success).toBe(true);
  });

  it("accepts http invoke with localhost", () => {
    const result = validateAgentProof(
      stringify(
        makeAgentProof({
          invoke: { type: "http", http: "http://localhost:3000/review" },
        }),
      ),
    );
    expect(result.success).toBe(true);
  });

  it("accepts agent proof with last_proof", () => {
    const result = validateAgentProof(
      stringify(
        makeAgentProof({
          last_proof: {
            score: 0.85,
            maturity: "developing",
            case_count: 20,
            variance: 0.05,
            timestamp: "2026-04-01T10:00:00Z",
          },
        }),
      ),
    );
    expect(result.success).toBe(true);
  });

  it("accepts agent proof with empty known_gaps", () => {
    const result = validateAgentProof(stringify(makeAgentProof({ known_gaps: [] })));
    expect(result.success).toBe(true);
  });

  // --- Negative tests ---

  it("rejects agent proof missing known_gaps", () => {
    const data = makeAgentProof();
    delete data.known_gaps;
    const result = validateAgentProof(stringify(data));
    expect(result.success).toBe(false);
  });

  it("rejects agent proof with absolute eval_suite path", () => {
    const result = validateAgentProof(
      stringify(makeAgentProof({ eval_suite: "/evals/code-reviewer" })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects agent proof with .. in eval_suite path", () => {
    const result = validateAgentProof(
      stringify(makeAgentProof({ eval_suite: "../evals/code-reviewer" })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects agent proof with ~ in eval_suite path", () => {
    const result = validateAgentProof(
      stringify(makeAgentProof({ eval_suite: "~/evals/code-reviewer" })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects agent proof with invalid invoke type", () => {
    const result = validateAgentProof(
      stringify(makeAgentProof({ invoke: { type: "mcp", endpoint: "foo" } })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects agent proof missing schema_version", () => {
    const data = makeAgentProof();
    delete data.schema_version;
    const result = validateAgentProof(stringify(data));
    expect(result.success).toBe(false);
  });

  it("rejects agent proof with wrong schema_version", () => {
    const result = validateAgentProof(stringify(makeAgentProof({ schema_version: "2" })));
    expect(result.success).toBe(false);
  });

  it("rejects http invoke with non-localhost http://", () => {
    const result = validateAgentProof(
      stringify(
        makeAgentProof({
          invoke: { type: "http", http: "http://api.example.com/review" },
        }),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid YAML", () => {
    const result = validateAgentProof("{ invalid yaml: [");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Eval suite — happy path
// ---------------------------------------------------------------------------

describe("validateEvalSuite", () => {
  it("accepts valid eval case with all three grading layers", () => {
    const c = makeEvalCase({
      grading: [
        { type: "deterministic", check: "contains", values: ["parameterized"] },
        { type: "heuristic", check: "line_count", min: 1, max: 50 },
        { type: "llm-judge", rubric: "Does the output identify the vulnerability?" },
      ],
    });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(true);
  });

  it("accepts valid eval case with only deterministic grading", () => {
    const result = validateEvalSuite(stringify([makeEvalCase()]));
    expect(result.success).toBe(true);
  });

  it("accepts valid eval suite with multiple cases", () => {
    const cases = [
      makeEvalCase(),
      makeEvalCase({ id: "xss-01", input: "<script>alert(1)</script>" }),
    ];
    const result = validateEvalSuite(stringify(cases));
    expect(result.success).toBe(true);
  });

  it("accepts eval case with expected grade only", () => {
    const c = makeEvalCase({ expected: { grade: "pass" } });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(true);
  });

  it("accepts eval case with skip: true", () => {
    const c = makeEvalCase({ skip: true });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]?.skip).toBe(true);
    }
  });

  // --- Negative tests ---

  it("rejects eval case with empty expected (no fields)", () => {
    const c = makeEvalCase({ expected: {} });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(false);
  });

  it("rejects eval suite with duplicate IDs", () => {
    const cases = [makeEvalCase(), makeEvalCase()];
    const result = validateEvalSuite(stringify(cases));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Duplicate");
    }
  });

  it("rejects eval case with no grading layers", () => {
    const c = makeEvalCase({ grading: [] });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(false);
  });

  it("rejects eval case with invalid grading type", () => {
    const c = makeEvalCase({ grading: [{ type: "vibes", score: 10 }] });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(false);
  });

  it("rejects heuristic layer with min > max", () => {
    const c = makeEvalCase({
      grading: [{ type: "heuristic", check: "word_count", min: 100, max: 10 }],
    });
    const result = validateEvalSuite(stringify([c]));
    expect(result.success).toBe(false);
  });

  it("rejects invalid YAML in eval suite", () => {
    const result = validateEvalSuite("not: [valid: yaml:");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Proof result — happy path
// ---------------------------------------------------------------------------

describe("validateProofResult", () => {
  it("accepts valid proof result with all fields", () => {
    const result = validateProofResult(stringify(makeProofResult()));
    expect(result.success).toBe(true);
  });

  it("accepts proof result without optional metadata fields", () => {
    const result = validateProofResult(
      stringify(
        makeProofResult({
          run_metadata: { invoke_type: "http" },
        }),
      ),
    );
    expect(result.success).toBe(true);
  });

  // --- Negative tests ---

  it("rejects proof result with confidence score > 1", () => {
    const result = validateProofResult(
      stringify(
        makeProofResult({
          confidence: { score: 1.5, maturity: "emerging", case_count: 5, variance: 0.1 },
        }),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("rejects proof result with negative variance", () => {
    const result = validateProofResult(
      stringify(
        makeProofResult({
          confidence: { score: 0.8, maturity: "emerging", case_count: 5, variance: -0.1 },
        }),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("rejects proof result with invalid maturity tier", () => {
    const result = validateProofResult(
      stringify(
        makeProofResult({
          confidence: { score: 0.8, maturity: "legendary", case_count: 5, variance: 0.1 },
        }),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("rejects proof result missing schema_version", () => {
    const data = makeProofResult();
    delete data.schema_version;
    const result = validateProofResult(stringify(data));
    expect(result.success).toBe(false);
  });

  it("rejects proof result with cases_passed + cases_failed != cases_run", () => {
    const result = validateProofResult(
      stringify(
        makeProofResult({
          cases_run: 5,
          cases_passed: 4,
          cases_failed: 4,
        }),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("rejects proof result with empty agent_id", () => {
    const result = validateProofResult(stringify(makeProofResult({ agent_id: "" })));
    expect(result.success).toBe(false);
  });

  it("rejects proof result with empty run_id", () => {
    const result = validateProofResult(stringify(makeProofResult({ run_id: "" })));
    expect(result.success).toBe(false);
  });

  it("rejects invalid YAML in proof result", () => {
    const result = validateProofResult("{{bad yaml");
    expect(result.success).toBe(false);
  });
});
