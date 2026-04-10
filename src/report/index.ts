import type { ProofResult } from "../schema/types.js";

/**
 * Format a proof result for output.
 *
 * JSON is the canonical format. Markdown is a human-readable summary — full
 * report generation is implemented in issue #14.
 */
export function formatReport(result: ProofResult, format: "json" | "markdown"): string {
  if (format === "markdown") {
    return formatMarkdown(result);
  }
  return JSON.stringify(result, null, 2);
}

function formatMarkdown(result: ProofResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Proof Result: ${result.agent_id}`);
  lines.push("");
  lines.push(`- **Run ID:** ${result.run_id}`);
  lines.push(`- **Timestamp:** ${result.timestamp}`);
  lines.push(`- **Invoke type:** ${result.run_metadata.invoke_type}`);
  if (result.run_metadata.duration_ms !== undefined) {
    lines.push(`- **Duration:** ${String(result.run_metadata.duration_ms)}ms`);
  }
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Cases run | ${String(result.cases_run)} |`);
  lines.push(`| Passed | ${String(result.cases_passed)} |`);
  lines.push(`| Failed | ${String(result.cases_failed)} |`);
  lines.push(`| Confidence | ${result.confidence.score.toFixed(3)} |`);
  lines.push(`| Variance | ${result.confidence.variance.toFixed(4)} |`);
  lines.push(`| Maturity | ${result.confidence.maturity} |`);
  lines.push("");

  // Per-case results
  lines.push("## Results");
  lines.push("");
  lines.push("| Case | Status | Output |");
  lines.push("|------|--------|--------|");
  for (const c of result.results) {
    const status = c.passed ? "PASS" : "FAIL";
    const raw = c.output.length > 80 ? c.output.slice(0, 77) + "..." : c.output;
    const preview = raw.replaceAll("\n", " ").replaceAll("|", "\\|");
    lines.push(`| ${c.case_id} | ${status} | ${preview} |`);
  }
  lines.push("");

  // Known gaps
  if (result.known_gaps.length > 0) {
    lines.push("## Known Gaps");
    lines.push("");
    for (const gap of result.known_gaps) {
      lines.push(`- ${gap}`);
    }
    lines.push("");
  }

  // Not checked
  if (result.not_checked.length > 0) {
    lines.push("## Not Checked");
    lines.push("");
    for (const item of result.not_checked) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
