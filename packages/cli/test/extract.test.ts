import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { run } from "../src/index.js";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

describe("extract command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "word-radar-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("single file processing", () => {
    it("extracts words from a .md file and writes CSV", async () => {
      const inputFile = join(tempDir, "test.md");
      const expectedOutput = join(tempDir, "test.words.csv");

      await writeFile(inputFile, "Running and jumping are fun activities.");

      await run(["node", "word-radar", "extract", inputFile]);

      expect(existsSync(expectedOutput)).toBe(true);
      const csv = await readFile(expectedOutput, "utf-8");
      expect(csv).toContain("lemma,flags");
      expect(csv).toMatch(/run,0/);
      expect(csv).toMatch(/jump,0/);
      expect(csv).toMatch(/activity,0/);
    });

    it("extracts words from a .txt file", async () => {
      const inputFile = join(tempDir, "document.txt");
      const expectedOutput = join(tempDir, "document.words.csv");

      await writeFile(inputFile, "The cats are running fast.");

      await run(["node", "word-radar", "extract", inputFile]);

      expect(existsSync(expectedOutput)).toBe(true);
      const csv = await readFile(expectedOutput, "utf-8");
      expect(csv).toContain("lemma,flags");
      expect(csv).toMatch(/cat,0/);
      expect(csv).toMatch(/run,0/);
      expect(csv).toMatch(/fast,0/);
    });

    it("respects -o/--out option to specify output path", async () => {
      const inputFile = join(tempDir, "input.md");
      const customOutput = join(tempDir, "custom.csv");

      await writeFile(inputFile, "Testing the output option.");

      await run(["node", "word-radar", "extract", inputFile, "-o", customOutput]);

      expect(existsSync(customOutput)).toBe(true);
      const csv = await readFile(customOutput, "utf-8");
      expect(csv).toContain("lemma,flags");
    });

    it("strips UTF-8 BOM from input file", async () => {
      const inputFile = join(tempDir, "bom.md");
      const expectedOutput = join(tempDir, "bom.words.csv");

      // UTF-8 BOM + content
      const bom = "﻿";
      await writeFile(inputFile, bom + "Hello world.");

      await run(["node", "word-radar", "extract", inputFile]);

      expect(existsSync(expectedOutput)).toBe(true);
      const csv = await readFile(expectedOutput, "utf-8");
      expect(csv).toContain("lemma,flags");
      expect(csv).toMatch(/hello,0/);
      expect(csv).toMatch(/world,0/);
    });

    it("handles empty file", async () => {
      const inputFile = join(tempDir, "empty.md");
      const expectedOutput = join(tempDir, "empty.words.csv");

      await writeFile(inputFile, "");

      await run(["node", "word-radar", "extract", inputFile]);

      expect(existsSync(expectedOutput)).toBe(true);
      const csv = await readFile(expectedOutput, "utf-8");
      expect(csv).toBe("lemma,flags\n");
    });

    it("exits with error when file does not exist", async () => {
      const nonExistent = join(tempDir, "no-such-file.md");

      await expect(
        run(["node", "word-radar", "extract", nonExistent]),
      ).rejects.toThrow();
    });

    it("rejects -o option when processing directory", async () => {
      const inputDir = join(tempDir, "dir");
      await mkdir(inputDir);
      await writeFile(join(inputDir, "test.md"), "content");

      await expect(
        run(["node", "word-radar", "extract", inputDir, "-o", join(tempDir, "out.csv")]),
      ).rejects.toThrow(/cannot use -o\/--out when processing a directory/i);
    });
  });

  describe("directory processing", () => {
    it("recursively processes .md and .txt files in a directory", async () => {
      const subdir = join(tempDir, "subdir");
      await mkdir(subdir);

      await writeFile(join(tempDir, "file1.md"), "Running fast.");
      await writeFile(join(tempDir, "file2.txt"), "Jumping high.");
      await writeFile(join(subdir, "nested.md"), "Swimming deep.");

      await run(["node", "word-radar", "extract", tempDir]);

      expect(existsSync(join(tempDir, "file1.words.csv"))).toBe(true);
      expect(existsSync(join(tempDir, "file2.words.csv"))).toBe(true);
      expect(existsSync(join(subdir, "nested.words.csv"))).toBe(true);
    });

    it("ignores hidden files (starting with .)", async () => {
      await writeFile(join(tempDir, "visible.md"), "Visible content.");
      await writeFile(join(tempDir, ".hidden.md"), "Hidden content.");

      await run(["node", "word-radar", "extract", tempDir]);

      expect(existsSync(join(tempDir, "visible.words.csv"))).toBe(true);
      expect(existsSync(join(tempDir, ".hidden.words.csv"))).toBe(false);
    });

    it("ignores node_modules directory", async () => {
      const nodeModules = join(tempDir, "node_modules");
      await mkdir(nodeModules);
      await writeFile(join(nodeModules, "package.md"), "Should be ignored.");

      await writeFile(join(tempDir, "real.md"), "Real content.");

      await run(["node", "word-radar", "extract", tempDir]);

      expect(existsSync(join(tempDir, "real.words.csv"))).toBe(true);
      expect(existsSync(join(nodeModules, "package.words.csv"))).toBe(false);
    });

    it("ignores non-.md/.txt files", async () => {
      await writeFile(join(tempDir, "test.md"), "Markdown content.");
      await writeFile(join(tempDir, "data.json"), '{"key": "value"}');
      await writeFile(join(tempDir, "script.js"), "console.log('test');");

      await run(["node", "word-radar", "extract", tempDir]);

      expect(existsSync(join(tempDir, "test.words.csv"))).toBe(true);
      expect(existsSync(join(tempDir, "data.words.csv"))).toBe(false);
      expect(existsSync(join(tempDir, "script.words.csv"))).toBe(false);
    });

    it("exits with error when directory does not exist", async () => {
      const nonExistent = join(tempDir, "no-such-dir");

      await expect(
        run(["node", "word-radar", "extract", nonExistent]),
      ).rejects.toThrow();
    });
  });

  describe("output format", () => {
    it("produces only valid lemma,flags lines", async () => {
      const inputFile = join(tempDir, "test.md");

      // 包含 URL、数字、代码标识符等，应该被过滤掉
      await writeFile(
        inputFile,
        "Running https://example.com test123 $scope camelCase snake_case",
      );

      await run(["node", "word-radar", "extract", inputFile]);

      const expectedOutput = join(tempDir, "test.words.csv");
      const csv = await readFile(expectedOutput, "utf-8");

      const lines = csv.trim().split("\n");
      // 表头 + 提取的词
      expect(lines[0]).toBe("lemma,flags");
      for (let i = 1; i < lines.length; i++) {
        const [lemma, flags] = lines[i]!.split(",");
        expect(lemma).toMatch(/^[a-z]+(?:['-][a-z]+)*$/);
        expect(flags).toMatch(/^\d+$/);
      }
    });
  });

  describe("progress output", () => {
    it("writes progress to stderr for each file", async () => {
      const inputFile = join(tempDir, "test.md");
      await writeFile(inputFile, "Testing progress output.");

      const writes: string[] = [];
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        return true;
      }) as typeof process.stderr.write;

      try {
        await run(["node", "word-radar", "extract", inputFile]);
      } finally {
        process.stderr.write = originalStderr;
      }

      const output = writes.join("");
      expect(output).toContain("test.md");
      expect(output).toContain("test.words.csv");
    });
  });

  describe("error handling", () => {
    it("shows clear error message for non-existent path", async () => {
      const nonExistent = join(tempDir, "nonexistent.md");

      const writes: string[] = [];
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        return true;
      }) as typeof process.stderr.write;

      try {
        await expect(
          run(["node", "word-radar", "extract", nonExistent]),
        ).rejects.toThrow();
      } finally {
        process.stderr.write = originalStderr;
      }

      const output = writes.join("");
      expect(output).toMatch(/does not exist|not found/i);
    });
  });
});