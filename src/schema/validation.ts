import { parse } from "yaml";
import { z, ZodError, ZodIssueCode, type ZodSafeParseResult } from "zod";
import {
  AgentProofSchema,
  EvalCaseSchema,
  ProofResultSchema,
  type AgentProof,
  type EvalCase,
  type ProofResult,
} from "./types.js";

const EvalSuiteSchema = z.array(EvalCaseSchema);

const MAX_YAML_SIZE = 1_048_576; // 1 MB

function makeError(message: string): ZodError {
  return new ZodError([{ code: ZodIssueCode.custom, path: [], message }]);
}

function parseYaml(
  yamlString: string,
): { ok: true; data: unknown } | { ok: false; error: ZodError } {
  if (yamlString.length > MAX_YAML_SIZE) {
    return {
      ok: false,
      error: makeError(`YAML input exceeds maximum size (${MAX_YAML_SIZE} bytes)`),
    };
  }
  try {
    return { ok: true, data: parse(yamlString) };
  } catch (e) {
    return {
      ok: false,
      error: makeError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`),
    };
  }
}

/** Parse YAML string and validate against the AgentProof schema. */
export function validateAgentProof(yamlString: string): ZodSafeParseResult<AgentProof> {
  const parsed = parseYaml(yamlString);
  if (!parsed.ok) {
    return { success: false, error: parsed.error } as ZodSafeParseResult<AgentProof>;
  }
  return AgentProofSchema.safeParse(parsed.data);
}

/** Parse YAML string as an array of eval cases and validate each one. Also checks for duplicate IDs. */
export function validateEvalSuite(yamlString: string): ZodSafeParseResult<EvalCase[]> {
  const parsed = parseYaml(yamlString);
  if (!parsed.ok) {
    return { success: false, error: parsed.error } as ZodSafeParseResult<EvalCase[]>;
  }

  const arrayResult = EvalSuiteSchema.safeParse(parsed.data);
  if (!arrayResult.success) {
    return arrayResult;
  }

  // Check for duplicate IDs
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const c of arrayResult.data) {
    if (ids.has(c.id)) {
      duplicates.push(c.id);
    }
    ids.add(c.id);
  }

  if (duplicates.length > 0) {
    return {
      success: false,
      error: makeError(`Duplicate case IDs: ${duplicates.join(", ")}`),
    } as ZodSafeParseResult<EvalCase[]>;
  }

  return arrayResult;
}

/** Parse YAML string and validate against the ProofResult schema. */
export function validateProofResult(yamlString: string): ZodSafeParseResult<ProofResult> {
  const parsed = parseYaml(yamlString);
  if (!parsed.ok) {
    return { success: false, error: parsed.error } as ZodSafeParseResult<ProofResult>;
  }
  return ProofResultSchema.safeParse(parsed.data);
}
