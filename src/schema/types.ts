import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Maximum size for string fields that will be passed to agents or stored in results. */
const MAX_INPUT_LENGTH = 65536;
const MAX_OUTPUT_LENGTH = 65536;

// ---------------------------------------------------------------------------
// Maturity tier
// ---------------------------------------------------------------------------

export const MaturityTierSchema = z.enum([
  "unestablished",
  "emerging",
  "developing",
  "established",
  "proven",
]);

export type MaturityTier = z.infer<typeof MaturityTierSchema>;

// ---------------------------------------------------------------------------
// Confidence (shared base)
// ---------------------------------------------------------------------------

/** Shared confidence fields used in both LastProof and ProofResult. */
export const ConfidenceBaseSchema = z.object({
  score: z.number().min(0).max(1),
  maturity: MaturityTierSchema,
  /** Cumulative case count across all runs, not just this run. */
  case_count: z.number().int().min(0),
  variance: z.number().min(0),
});

// ---------------------------------------------------------------------------
// Agent proof
// ---------------------------------------------------------------------------

const CommandInvokeSchema = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
});

const localhostPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/;

const HttpInvokeSchema = z.object({
  type: z.literal("http"),
  http: z
    .string()
    .url()
    .refine((v) => v.startsWith("https://") || localhostPattern.test(v), {
      message: "http invoke must use HTTPS (http:// only allowed for localhost)",
    }),
});

/**
 * How to invoke the agent under test.
 *
 * v1 supports command and http. MCP/subagent invocation is a known gap for
 * future schema versions.
 *
 * v1 input is always a string passed via stdin (command) or request body (http).
 * Structured inputs are a known gap for future schema versions.
 *
 * Trust model: the invoke config is trusted — it controls what commands are
 * spawned and what URLs are called. Users must review agent configs before
 * running them, the same way they would review a Makefile or CI script.
 */
export const InvokeSchema = z.discriminatedUnion("type", [CommandInvokeSchema, HttpInvokeSchema]);

export type Invoke = z.infer<typeof InvokeSchema>;

/** Allowlist: alphanumeric, hyphens, underscores, dots, forward slashes. No leading / or ~, no .. segments. */
const evalSuitePathPattern = /^[a-zA-Z0-9_-][a-zA-Z0-9_\-./]*$/;

const LastProofSchema = ConfidenceBaseSchema.extend({
  timestamp: z.string().datetime(),
});

export const AgentProofSchema = z.object({
  schema_version: z.literal("1"),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    version: z.string(),
  }),
  invoke: InvokeSchema,
  known_gaps: z.array(z.string()),
  eval_suite: z
    .string()
    .min(1)
    .refine((v) => evalSuitePathPattern.test(v) && !v.includes(".."), {
      message:
        "eval_suite must be a relative path using only [a-zA-Z0-9_-./], no leading / or ~, no .. segments",
    }),
  last_proof: LastProofSchema.optional(),
});

export type AgentProof = z.infer<typeof AgentProofSchema>;

// ---------------------------------------------------------------------------
// Grading layers
// ---------------------------------------------------------------------------

const DeterministicLayerSchema = z.object({
  type: z.literal("deterministic"),
  check: z.string(),
  values: z.array(z.string()).optional(),
});

const HeuristicLayerSchema = z
  .object({
    type: z.literal("heuristic"),
    check: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: "heuristic layer min must be <= max",
  });

const LlmJudgeLayerSchema = z.object({
  type: z.literal("llm-judge"),
  rubric: z.string(),
});

/**
 * Grading layer — discriminated union on "type".
 *
 * Array order defines execution order. Convention: deterministic first,
 * heuristic second, llm-judge last.
 */
export const GradingLayerSchema = z.discriminatedUnion("type", [
  DeterministicLayerSchema,
  HeuristicLayerSchema,
  LlmJudgeLayerSchema,
]);

export type GradingLayer = z.infer<typeof GradingLayerSchema>;

// ---------------------------------------------------------------------------
// Eval case
// ---------------------------------------------------------------------------

const ExpectedSchema = z
  .object({
    must_contain: z.array(z.string()).optional(),
    must_not_contain: z.array(z.string()).optional(),
    grade: z.enum(["pass", "fail"]).optional(),
  })
  .refine(
    (v) =>
      v.must_contain !== undefined || v.must_not_contain !== undefined || v.grade !== undefined,
    {
      message: "expected must have at least one of must_contain, must_not_contain, or grade",
    },
  );

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  input: z.string().max(MAX_INPUT_LENGTH),
  expected: ExpectedSchema.optional(),
  /**
   * Array order defines execution order. Convention: deterministic first,
   * heuristic second, llm-judge last.
   */
  grading: z.array(GradingLayerSchema).min(1),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  skip: z.boolean().default(false),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

// ---------------------------------------------------------------------------
// Proof result
// ---------------------------------------------------------------------------

const CaseResultSchema = z.object({
  case_id: z.string().min(1),
  passed: z.boolean(),
  output: z.string().max(MAX_OUTPUT_LENGTH),
  // TODO: Tighten grading_details shape once grading layers (#4-6) define their output formats
  grading_details: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const ProofResultSchema = z
  .object({
    schema_version: z.literal("1"),
    agent_id: z.string().min(1),
    run_id: z.string().min(1),
    timestamp: z.string().datetime(),
    cases_run: z.number().int().min(0),
    cases_passed: z.number().int().min(0),
    cases_failed: z.number().int().min(0),
    confidence: ConfidenceBaseSchema,
    known_gaps: z.array(z.string()),
    not_checked: z.array(z.string()),
    run_metadata: z.object({
      model: z.string().optional(),
      temperature: z.number().optional(),
      invoke_type: z.enum(["command", "http"]),
      duration_ms: z.number().optional(),
    }),
    results: z.array(CaseResultSchema),
  })
  .refine((v) => v.cases_passed + v.cases_failed === v.cases_run, {
    message: "cases_passed + cases_failed must equal cases_run",
  });

export type ProofResult = z.infer<typeof ProofResultSchema>;
