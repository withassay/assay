import type { EvalCase, GradingLayer } from "../schema/types.js";

/** Result of a single grading layer evaluation. */
export interface GradingLayerResult {
  layer_type: GradingLayer["type"];
  check: string;
  passed: boolean;
  /** Normalized score from 0.0 (complete fail) to 1.0 (complete pass). */
  score: number;
  details: string;
  /** Token usage for LLM-judge calls. Populated by issues #4-6. */
  token_usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Run all grading layers for a single case against the agent output.
 *
 * STUB: returns all-pass until issues #4-6 implement real grading.
 */
export function gradeCase(evalCase: EvalCase, _agentOutput: string): GradingLayerResult[] {
  return evalCase.grading.map((layer): GradingLayerResult => {
    const check = layer.type === "llm-judge" ? "llm-judge" : layer.check;
    return {
      layer_type: layer.type,
      check,
      passed: true,
      score: 1.0,
      details: "STUB: grading not yet implemented",
    };
  });
}
