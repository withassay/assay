import { describe, it, expect } from "vitest";

describe("schema", () => {
  it("exports are defined", async () => {
    const schema = await import("./index.js");
    expect(schema).toBeDefined();
  });
});
