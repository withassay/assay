import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeAgent } from "./index.js";
import type { Invoke } from "../schema/types.js";

describe("invokeAgent — command", () => {
  const echoInvoke: Invoke = { type: "command", command: "echo hello" };

  it("captures stdout from a simple command", async () => {
    const result = await invokeAgent(echoInvoke, "", 5000);
    expect(result.output.trim()).toBe("hello");
    expect(result.exit_code).toBe(0);
    expect(result.status_code).toBeNull();
    expect(result.timed_out).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("pipes stdin to the command", async () => {
    const catInvoke: Invoke = { type: "command", command: "cat" };
    const result = await invokeAgent(catInvoke, "test input", 5000);
    expect(result.output).toBe("test input");
    expect(result.exit_code).toBe(0);
  });

  it("times out and kills long-running commands", async () => {
    const sleepInvoke: Invoke = { type: "command", command: "sleep 60" };
    const result = await invokeAgent(sleepInvoke, "", 100);
    expect(result.timed_out).toBe(true);
    expect(result.duration_ms).toBeLessThan(5000);
  });

  it("captures output from commands with non-zero exit code", async () => {
    const result = await invokeAgent(
      { type: "command", command: "node -e process.exit(42)" },
      "",
      5000,
    );
    expect(result.exit_code).toBe(42);
    expect(result.timed_out).toBe(false);
  });

  it("returns immediately when abort signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await invokeAgent(echoInvoke, "", 5000, ac.signal);
    expect(result.output).toBe("");
    expect(result.duration_ms).toBe(0);
  });

  it("aborts in-flight command when external signal fires", async () => {
    const ac = new AbortController();
    const sleepInvoke: Invoke = { type: "command", command: "sleep 60" };
    const promise = invokeAgent(sleepInvoke, "", 30000, ac.signal);

    // Abort after a short delay
    setTimeout(() => ac.abort(), 50);

    const result = await promise;
    expect(result.duration_ms).toBeLessThan(5000);
  });
});

describe("invokeAgent — http", () => {
  const httpInvoke: Invoke = { type: "http", http: "https://example.com/agent" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST with JSON body and returns response text", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("agent response", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeAgent(httpInvoke, "test input", 5000);
    expect(result.output).toBe("agent response");
    expect(result.exit_code).toBeNull();
    expect(result.status_code).toBe(200);
    expect(result.timed_out).toBe(false);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/agent");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(opts.body).toBe(JSON.stringify({ input: "test input" }));
  });

  it("handles HTTP timeout", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeAgent(httpInvoke, "test", 100);
    expect(result.timed_out).toBe(true);
    expect(result.output).toBe("");
  });

  it("captures non-2xx responses as output", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeAgent(httpInvoke, "test", 5000);
    expect(result.output).toBe("Internal Server Error");
    expect(result.timed_out).toBe(false);
  });

  it("returns immediately when abort signal is already aborted", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const ac = new AbortController();
    ac.abort();
    const result = await invokeAgent(httpInvoke, "test", 5000, ac.signal);
    expect(result.output).toBe("");
    expect(result.duration_ms).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
