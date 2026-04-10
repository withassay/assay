import { spawn } from "node:child_process";
import type { Invoke } from "../schema/types.js";

/** Maximum output size in characters — matches MAX_OUTPUT_LENGTH in schema. */
const MAX_OUTPUT_LENGTH = 65536;

export interface InvokeResult {
  output: string;
  duration_ms: number;
  /** Process exit code. null for http invocations or if the process was killed. */
  exit_code: number | null;
  /** HTTP status code. null for command invocations. */
  status_code: number | null;
  timed_out: boolean;
  /** True if the output was truncated to MAX_OUTPUT_LENGTH. */
  truncated: boolean;
}

/**
 * Invoke the agent with the given input string, respecting the timeout.
 *
 * For command: spawns subprocess, passes input via stdin, captures stdout.
 * For http: POSTs input as JSON body, reads response body.
 */
export async function invokeAgent(
  invoke: Invoke,
  input: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<InvokeResult> {
  if (invoke.type === "command") {
    return invokeCommand(invoke.command, input, timeoutMs, abortSignal);
  }
  return invokeHttp(invoke.http, input, timeoutMs, abortSignal);
}

function invokeCommand(
  command: string,
  input: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<InvokeResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();

    // Naive space-split for v1. Quoted arguments are not supported.
    const parts = command.split(/\s+/).filter((s) => s.length > 0);
    const cmd = parts[0];
    if (cmd === undefined) {
      reject(new Error("Empty command string"));
      return;
    }
    const args = parts.slice(1);

    const ac = new AbortController();
    let timedOut = false;

    // Timeout via AbortController + setTimeout (works on Node 20.0+)
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);

    // If external abort signal fires (fail-fast), abort this invocation too
    const onExternalAbort = (): void => {
      ac.abort();
    };
    if (externalSignal !== undefined) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        resolve({
          output: "",
          duration_ms: 0,
          exit_code: null,
          status_code: null,
          timed_out: false,
          truncated: false,
        });
        return;
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      signal: ac.signal,
    });

    const chunks: Buffer[] = [];
    let totalLength = 0;
    let truncated = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (totalLength < MAX_OUTPUT_LENGTH) {
        chunks.push(chunk);
        totalLength += chunk.length;
        if (totalLength > MAX_OUTPUT_LENGTH) {
          truncated = true;
        }
      }
    });

    // Capture stderr but don't include in output — agent output is stdout only
    child.stderr.on("data", () => {
      // Intentionally discarded. Stderr is not part of the eval output.
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      const duration_ms = Math.round(performance.now() - start);

      if (err.code === "ABORT_ERR" || ac.signal.aborted) {
        resolve({
          output: buildOutput(chunks),
          duration_ms,
          exit_code: null,
          status_code: null,
          timed_out: timedOut,
          truncated,
        });
        return;
      }

      reject(new Error(`Failed to spawn command "${command}": ${err.message}`));
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      const duration_ms = Math.round(performance.now() - start);

      if (truncated) {
        process.stderr.write(
          `[assay] Warning: output truncated to ${String(MAX_OUTPUT_LENGTH)} chars for command "${command}"\n`,
        );
      }

      resolve({
        output: buildOutput(chunks),
        duration_ms,
        exit_code: code,
        status_code: null,
        timed_out: timedOut,
        truncated,
      });
    });

    // Write input to stdin and close
    if (child.stdin !== null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function invokeHttp(
  url: string,
  input: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<InvokeResult> {
  const start = performance.now();

  // Combine timeout + external abort signal
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, timeoutMs);

  const onExternalAbort = (): void => {
    ac.abort();
  };
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      return {
        output: "",
        duration_ms: 0,
        exit_code: null,
        status_code: null,
        timed_out: false,
        truncated: false,
      };
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
      signal: ac.signal,
      redirect: "error",
    });

    let output = await response.text();
    let truncated = false;
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH);
      truncated = true;
      process.stderr.write(
        `[assay] Warning: HTTP response truncated to ${String(MAX_OUTPUT_LENGTH)} chars from ${url}\n`,
      );
    }

    const duration_ms = Math.round(performance.now() - start);
    return {
      output,
      duration_ms,
      exit_code: null,
      status_code: response.status,
      timed_out: false,
      truncated,
    };
  } catch (err: unknown) {
    const duration_ms = Math.round(performance.now() - start);

    if (err instanceof DOMException && err.name === "AbortError") {
      const timedOut = !externalSignal?.aborted;
      return {
        output: "",
        duration_ms,
        exit_code: null,
        status_code: null,
        timed_out: timedOut,
        truncated: false,
      };
    }

    throw new Error(
      `HTTP invocation failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

function buildOutput(chunks: Buffer[]): string {
  const full = Buffer.concat(chunks).toString("utf-8");
  if (full.length > MAX_OUTPUT_LENGTH) {
    return full.slice(0, MAX_OUTPUT_LENGTH);
  }
  return full;
}
