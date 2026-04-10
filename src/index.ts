/**
 * @withassay/assay — Proof system for AI agents
 *
 * Make quality measurable, improvable, and transferable.
 */

export {
  AgentProofSchema,
  ConfidenceBaseSchema,
  EvalCaseSchema,
  GradingLayerSchema,
  InvokeSchema,
  MaturityTierSchema,
  ProofResultSchema,
  type AgentProof,
  type EvalCase,
  type GradingLayer,
  type Invoke,
  type MaturityTier,
  type ProofResult,
  validateAgentProof,
  validateEvalSuite,
  validateProofResult,
} from "./schema/index.js";

export { invokeAgent, type InvokeResult } from "./invoke/index.js";
export {
  runEvalSuite,
  type RunOptions,
  type RunResult,
  type CaseTimingDetail,
} from "./runner/index.js";
export { gradeCase, type GradingLayerResult } from "./grading/index.js";
export { computeConfidence, type ConfidenceResult } from "./confidence/index.js";
export { formatReport } from "./report/index.js";
