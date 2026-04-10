import { parseArgs } from "node:util";

export interface CliArgs {
  command: "eval" | "help";
  config: string;
  tag: string | undefined;
  repeat: number;
  format: "json" | "markdown";
  concurrency: number;
  dryRun: boolean;
  failFast: boolean;
  timeout: number;
}

/**
 * Parse CLI arguments using Node's built-in util.parseArgs.
 *
 * @param argv - process.argv.slice(2) — positionals + flags only, no node/script path.
 * @throws {Error} on invalid flag values or unknown flags.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      config: { type: "string", default: "./assay.yaml" },
      tag: { type: "string" },
      repeat: { type: "string", default: "1" },
      format: { type: "string", default: "json" },
      concurrency: { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
      "fail-fast": { type: "boolean", default: false },
      timeout: { type: "string", default: "30000" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help === true) {
    return makeHelpArgs();
  }

  const command = positionals[0];
  if (command === undefined || command !== "eval") {
    return makeHelpArgs();
  }

  const repeat = parseBoundedInt(values.repeat as string, "repeat", 1000); // safe: has default
  const concurrency = parseBoundedInt(values.concurrency as string, "concurrency", 64); // safe: has default
  const timeout = parsePositiveInt(values.timeout as string, "timeout"); // safe: has default

  const format = values.format as string;
  if (format !== "json" && format !== "markdown") {
    throw new Error(`Invalid --format value "${format}". Must be "json" or "markdown".`);
  }

  return {
    command: "eval",
    config: values.config as string,
    tag: values.tag as string | undefined,
    repeat,
    format,
    concurrency,
    dryRun: values["dry-run"] as boolean,
    failFast: values["fail-fast"] as boolean,
    timeout,
  };
}

function makeHelpArgs(): CliArgs {
  return {
    command: "help",
    config: "./assay.yaml",
    tag: undefined,
    repeat: 1,
    format: "json",
    concurrency: 1,
    dryRun: false,
    failFast: false,
    timeout: 30000,
  };
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--${name} must be a positive integer, got "${value}".`);
  }
  return n;
}

function parseBoundedInt(value: string, name: string, max: number): number {
  const n = parsePositiveInt(value, name);
  if (n > max) {
    throw new Error(`--${name} must be at most ${String(max)}, got "${value}".`);
  }
  return n;
}

export function printUsage(): void {
  const usage = `
Usage: assay <command> [options]

Commands:
  eval    Run eval cases against an agent and produce a proof result

Options:
  --config <path>       Path to agent config file (default: ./assay.yaml)
  --tag <tag>           Run only cases matching this tag
  --repeat <n>          Run each case N times for variance measurement (default: 1)
  --format <fmt>        Output format: json | markdown (default: json)
  --concurrency <n>     Max parallel case invocations (default: 1, sequential)
  --dry-run             Validate config and list cases without executing
  --fail-fast           Stop on first case failure
  --timeout <ms>        Per-case timeout in milliseconds (default: 30000)
  -h, --help            Show this help message

Examples:
  assay eval
  assay eval --config ./my-agent.yaml --tag security
  assay eval --repeat 3 --format markdown
  assay eval --concurrency 4 --fail-fast
`.trimStart();

  process.stdout.write(usage);
}
