import { describe, expect, it } from "vitest";
import { run } from "../src/index.js";

describe("@word-radar/cli", () => {
  it("shows version", async () => {
    const writes: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    try {
      // exitOverride() 会让 --version 也抛出错误，但输出会先写入 stdout
      await run(["node", "word-radar", "--version"]);
    } catch (error) {
      // --version 会抛出 CommanderError，这是预期行为
      // 我们只需要验证 stdout 输出了版本号
    } finally {
      process.stdout.write = originalStdout;
    }

    expect(writes.join("")).toMatch(/\d+\.\d+\.\d+/);
  });

  it("exits with an error for an unknown command", async () => {
    await expect(run(["node", "word-radar", "no-such-cmd"])).rejects.toThrow();
  });

  it("exits with an error when extract command is called without path", async () => {
    await expect(run(["node", "word-radar", "extract"])).rejects.toThrow();
  });
});