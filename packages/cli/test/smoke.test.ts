import { describe, expect, it } from "vitest";
import { run } from "../src/index.js";

describe("@word-radar/cli", () => {
  it("runs the hello command via programmatic API", async () => {
    const writes: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    try {
      await run(["node", "word-radar", "hello", "world"]);
    } finally {
      process.stdout.write = originalStdout;
    }

    expect(writes.join("")).toContain("hello, world!");
  });

  it("exits with an error for an unknown command", async () => {
    // 把 exit 抛成错误抛回来，验 commander 真的会拒绝未知子命令。
    await expect(run(["node", "word-radar", "no-such-cmd"])).rejects.toThrow();
  });
});