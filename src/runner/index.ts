import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentProof, EvalCase, ProofResult } from "../schema/types.js";
import { validateEvalSuite } from "../schema/validation.js";
import { invokeAgent } from "../invoke/index.js";
import { gradeCase } from "../grading/index.js";
import { computeConfidence } from "../confidence/index.js";

export interface RunOptions {
  config: AgentProof;
  /** Working directory — eval_suite is resolved relative to this. */
  configDir: string;
  tag: string | undefined;
  repeat: number;
  concurrency: number;
  failFast: boolean;
  timeout: number;
  dryRun: boolean;
}

export interface CaseTimingDetail {
  case_id: string;
  repeat_index: number;
  start_time: string;
  end_time: string;
  duration_ms: number;
  timed_out: boolean;
  exit_code: number | null;
  passed: boolean;
}

export interface RunResult {
  proofResult: ProofResult;
  timings: CaseTimingDetail[];
}

/** Internal type for tracking per-invocation results before aggregation. */
interface InvocationRecord {
  case_id: string;
  repeat_index: number;
  passed: boolean;
  output: string;
  grading_details: Record<string, unknown>[];
  timing: CaseTimingDetail;
}

/**
 * Load eval cases, filter, execute, grade, and aggregate into a proof result.
 */
export async function runEvalSuite(options: RunOptions): Promise<RunResult> {
  const { config, configDir, tag, repeat, concurrency, failFast, timeout, dryRun } = options;

  // 1. Load and validate eval cases
  const evalSuiteDir = resolve(configDir, config.eval_suite);
  const allCases = await loadEvalCases(evalSuiteDir);

  // 2. Filter
  const filteredCases = filterCases(allCases, tag);

  // 3. Dry run
  if (dryRun) {
    return buildDryRunResult(config, filteredCases);
  }

  // 4. Build invocation list (cases × repeats)
  const invocations: Array<{ evalCase: EvalCase; repeatIndex: number }> = [];
  for (const evalCase of filteredCases) {
    for (let r = 0; r < repeat; r++) {
      invocations.push({ evalCase, repeatIndex: r });
    }
  }

  // 5. Execute with concurrency limiter
  const runStart = performance.now();
  const ac = new AbortController();

  const tasks = invocations.map(
    ({ evalCase, repeatIndex }) =>
      (): Promise<InvocationRecord> =>
        executeInvocation(config, evalCase, repeatIndex, timeout, ac.signal),
  );

  const records = await runWithConcurrency(tasks, concurrency, failFast, ac);
  const runDuration = Math.round(performance.now() - runStart);

  // 6. Aggregate per case
  const timings = records.map((r) => r.timing);
  const proofResult = aggregateResults(config, filteredCases, records, repeat, runDuration);

  return { proofResult, timings };
}

/**
 * Load all .yaml/.yml files from the eval suite directory.
 * Each file contains an array of EvalCase. Validates each file and checks
 * for duplicate IDs across files.
 */
async function loadEvalCases(suiteDir: string): Promise<EvalCase[]> {
  let entries: string[];
  try {
    entries = await readdir(suiteDir);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`Eval suite directory not found: ${suiteDir}`, { cause: err });
    }
    throw err;
  }

  const yamlFiles = entries.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();

  if (yamlFiles.length === 0) {
    throw new Error(`No .yaml files found in eval suite directory: ${suiteDir}`);
  }

  const allCases: EvalCase[] = [];
  const seenIds = new Set<string>();

  for (const file of yamlFiles) {
    const filePath = join(suiteDir, file);
    const content = await readFile(filePath, "utf-8");
    const result = validateEvalSuite(content);

    if (!result.success) {
      throw new Error(`Invalid eval suite file ${file}: ${result.error.message}`);
    }

    for (const evalCase of result.data) {
      if (seenIds.has(evalCase.id)) {
        throw new Error(`Duplicate case ID "${evalCase.id}" found across eval suite files`);
      }
      seenIds.add(evalCase.id);
      allCases.push(evalCase);
    }
  }

  return allCases;
}

function filterCases(cases: EvalCase[], tag: string | undefined): EvalCase[] {
  let filtered = cases.filter((c) => !c.skip);

  if (tag !== undefined) {
    filtered = filtered.filter((c) => c.tags.includes(tag));
  }

  return filtered;
}

function buildDryRunResult(config: AgentProof, cases: EvalCase[]): RunResult {
  // Log case listing to stderr so stdout stays clean for JSON output
  process.stderr.write(`\nDry run: ${String(cases.length)} case(s) would be executed\n\n`);
  for (const c of cases) {
    const tags = c.tags.length > 0 ? ` [${c.tags.join(", ")}]` : "";
    const diff = c.difficulty !== undefined ? ` (${c.difficulty})` : "";
    process.stderr.write(`  ${c.id}${tags}${diff}\n`);
  }
  process.stderr.write("\n");

  const proofResult: ProofResult = {
    schema_version: "1",
    agent_id: config.agent.id,
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    cases_run: 0,
    cases_passed: 0,
    cases_failed: 0,
    confidence: { score: 0, maturity: "unestablished", case_count: 0, variance: 0 },
    known_gaps: config.known_gaps,
    not_checked: [],
    run_metadata: { invoke_type: config.invoke.type },
    results: [],
  };

  return { proofResult, timings: [] };
}

async function executeInvocation(
  config: AgentProof,
  evalCase: EvalCase,
  repeatIndex: number,
  timeout: number,
  abortSignal: AbortSignal,
): Promise<InvocationRecord> {
  const startTime = new Date().toISOString();
  const invokeResult = await invokeAgent(config.invoke, evalCase.input, timeout, abortSignal);
  const endTime = new Date().toISOString();

  const gradingResults = gradeCase(evalCase, invokeResult.output);
  const passed = gradingResults.every((g) => g.passed);

  const gradingDetails = gradingResults.map((g) => ({
    layer_type: g.layer_type,
    check: g.check,
    passed: g.passed,
    score: g.score,
    details: g.details,
    ...(g.token_usage !== undefined ? { token_usage: g.token_usage } : {}),
  }));

  return {
    case_id: evalCase.id,
    repeat_index: repeatIndex,
    passed,
    output: invokeResult.output,
    grading_details: gradingDetails,
    timing: {
      case_id: evalCase.id,
      repeat_index: repeatIndex,
      start_time: startTime,
      end_time: endTime,
      duration_ms: invokeResult.duration_ms,
      timed_out: invokeResult.timed_out,
      exit_code: invokeResult.exit_code,
      passed,
    },
  };
}

function aggregateResults(
  config: AgentProof,
  cases: EvalCase[],
  records: InvocationRecord[],
  repeat: number,
  totalDurationMs: number,
): ProofResult {
  // Group records by case_id
  const byCaseId = new Map<string, InvocationRecord[]>();
  for (const record of records) {
    const existing = byCaseId.get(record.case_id);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      byCaseId.set(record.case_id, [record]);
    }
  }

  const caseResults: Array<{
    case_id: string;
    passed: boolean;
    output: string;
    grading_details: Record<string, unknown>[];
  }> = [];
  const passRates: number[] = [];

  for (const evalCase of cases) {
    const caseRecords = byCaseId.get(evalCase.id) ?? [];

    if (caseRecords.length === 0) {
      // Case was skipped (fail-fast abort) — mark as failed
      caseResults.push({
        case_id: evalCase.id,
        passed: false,
        output: "",
        grading_details: [],
      });
      passRates.push(0);
      continue;
    }

    const passedCount = caseRecords.filter((r) => r.passed).length;
    const allPassed = passedCount === caseRecords.length;
    const passRate = passedCount / caseRecords.length;
    passRates.push(passRate);

    // Output: first failure's output, or last run's output if all passed
    let output: string;
    if (allPassed) {
      const lastRecord = caseRecords[caseRecords.length - 1];
      output = lastRecord?.output ?? "";
    } else {
      const firstFailure = caseRecords.find((r) => !r.passed);
      output = firstFailure?.output ?? "";
    }

    // Build grading_details with per-repeat breakdown when repeat > 1
    let gradingDetails: Record<string, unknown>[];
    if (repeat > 1) {
      gradingDetails = caseRecords.map((r) => ({
        repeat: r.repeat_index,
        passed: r.passed,
        grading: r.grading_details,
      }));
    } else {
      gradingDetails = caseRecords[0]?.grading_details ?? [];
    }

    caseResults.push({
      case_id: evalCase.id,
      passed: allPassed,
      output,
      grading_details: gradingDetails,
    });
  }

  const casesPassed = caseResults.filter((r) => r.passed).length;
  const casesFailed = caseResults.length - casesPassed;
  const confidence = computeConfidence(passRates);

  return {
    schema_version: "1",
    agent_id: config.agent.id,
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    cases_run: caseResults.length,
    cases_passed: casesPassed,
    cases_failed: casesFailed,
    confidence,
    known_gaps: config.known_gaps,
    not_checked: [],
    run_metadata: {
      invoke_type: config.invoke.type,
      duration_ms: totalDurationMs,
    },
    results: caseResults,
  };
}

/**
 * Execute async tasks with a concurrency limit.
 *
 * If failFast is true and any task result has passed=false, the AbortController
 * is signaled to abort remaining and in-flight tasks.
 */
async function runWithConcurrency(
  tasks: Array<() => Promise<InvocationRecord>>,
  limit: number,
  failFast: boolean,
  ac: AbortController,
): Promise<InvocationRecord[]> {
  const results: InvocationRecord[] = [];
  let index = 0;
  let aborted = false;

  async function runNext(): Promise<void> {
    while (index < tasks.length && !aborted) {
      const currentIndex = index;
      index++;
      const task = tasks[currentIndex];
      if (task === undefined) break;
      const result = await task();
      results.push(result);

      if (failFast && !result.passed) {
        aborted = true;
        ac.abort();
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);

  return results;
}
