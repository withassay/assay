#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseCliArgs, printUsage } from "./args.js";
import { validateAgentProof } from "../schema/validation.js";
import { runEvalSuite } from "../runner/index.js";
import { formatReport } from "../report/index.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err: unknown) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n\n`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.command === "help") {
    printUsage();
    return;
  }

  // Load and validate agent config
  const configPath = resolve(args.config);
  let configYaml: string;
  try {
    configYaml = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      process.stderr.write(`Error: Config file not found: ${configPath}\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const configResult = validateAgentProof(configYaml);
  if (!configResult.success) {
    process.stderr.write(`Error: Invalid agent config at ${configPath}\n`);
    for (const issue of configResult.error.issues) {
      process.stderr.write(`  - ${issue.path.join(".")}: ${issue.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const result = await runEvalSuite({
    config: configResult.data,
    configDir: dirname(configPath),
    tag: args.tag,
    repeat: args.repeat,
    concurrency: args.concurrency,
    failFast: args.failFast,
    timeout: args.timeout,
    dryRun: args.dryRun,
  });

  const output = formatReport(result.proofResult, args.format);
  process.stdout.write(output + "\n");

  if (args.dryRun) {
    process.exitCode = 0;
  } else {
    process.exitCode = result.proofResult.cases_failed > 0 ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
