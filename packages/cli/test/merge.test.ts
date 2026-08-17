import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { run } from "../src/index.js";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("merge command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "word-radar-merge-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: write a CSV file with BOM-free content.
   */
  async function writeCsv(fileName: string, content: string): Promise<string> {
    const path = join(tempDir, fileName);
    await writeFile(path, content, "utf-8");
    return path;
  }

  /**
   * Helper: capture stdout during a run.
   */
  async function runCaptureStdout(
    argv: string[],
  ): Promise<{ stdout: string; error?: unknown }> {
    const writes: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    let error: unknown;
    try {
      await run(argv);
    } catch (e) {
      error = e;
    } finally {
      process.stdout.write = originalStdout;
    }

    return { stdout: writes.join(""), error };
  }

  describe("two files with overlap", () => {
    it("merges overlapping words with flags ORed, keeps non-overlapping words", async () => {
      const a = await writeCsv(
        "a.csv",
        "lemma,flags\nrun,1\ncat,0\ndog,2\n",
      );
      const b = await writeCsv(
        "b.csv",
        "lemma,flags\nrun,2\nbird,0\ndog,4\n",
      );

      const { stdout, error } = await runCaptureStdout([
        "node",
        "word-radar",
        "merge",
        a,
        b,
      ]);

      expect(error).toBeUndefined();
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("lemma,flags");

      // Build a map from the output
      const map = new Map<string, number>();
      for (let i = 1; i < lines.length; i++) {
        const [lemma, flags] = lines[i]!.split(",");
        map.set(lemma!, Number(flags));
      }

      // run: 1 | 2 = 3
      expect(map.get("run")).toBe(3);
      // dog: 2 | 4 = 6
      expect(map.get("dog")).toBe(6);
      // cat: only in a, flags=0
      expect(map.get("cat")).toBe(0);
      // bird: only in b, flags=0
      expect(map.get("bird")).toBe(0);
    });
  });

  describe("two files with no overlap", () => {
    it("keeps all words from both files", async () => {
      const a = await writeCsv("a.csv", "lemma,flags\ncat,0\n");
      const b = await writeCsv("b.csv", "lemma,flags\ndog,0\n");

      const { stdout, error } = await runCaptureStdout([
        "node",
        "word-radar",
        "merge",
        a,
        b,
      ]);

      expect(error).toBeUndefined();
      expect(stdout).toMatch(/cat,0/);
      expect(stdout).toMatch(/dog,0/);
    });
  });

  describe("three or more files", () => {
    it("merges three files correctly", async () => {
      const a = await writeCsv("a.csv", "lemma,flags\nrun,1\n");
      const b = await writeCsv("b.csv", "lemma,flags\nrun,2\n");
      const c = await writeCsv("c.csv", "lemma,flags\nrun,4\ncat,0\n");

      const { stdout, error } = await runCaptureStdout([
        "node",
        "word-radar",
        "merge",
        a,
        b,
        c,
      ]);

      expect(error).toBeUndefined();
      const lines = stdout.trim().split("\n");
      const map = new Map<string, number>();
      for (let i = 1; i < lines.length; i++) {
        const [lemma, flags] = lines[i]!.split(",");
        map.set(lemma!, Number(flags));
      }

      // run: 1 | 2 | 4 = 7
      expect(map.get("run")).toBe(7);
      expect(map.get("cat")).toBe(0);
    });
  });

  describe("-o/--out option", () => {
    it("writes merged output to file instead of stdout", async () => {
      const a = await writeCsv("a.csv", "lemma,flags\nrun,1\n");
      const b = await writeCsv("b.csv", "lemma,flags\nrun,2\n");
      const outPath = join(tempDir, "merged.csv");

      const { stdout, error } = await runCaptureStdout([
        "node",
        "word-radar",
        "merge",
        a,
        b,
        "-o",
        outPath,
      ]);

      expect(error).toBeUndefined();
      // stdout should be empty when -o is used
      expect(stdout.trim()).toBe("");

      const fileContent = await readFile(outPath, "utf-8");
      const lines = fileContent.trim().split("\n");
      const map = new Map<string, number>();
      for (let i = 1; i < lines.length; i++) {
        const [lemma, flags] = lines[i]!.split(",");
        map.set(lemma!, Number(flags));
      }
      expect(map.get("run")).toBe(3);
    });
  });

  describe("UTF-8 BOM handling", () => {
    it("strips UTF-8 BOM from input files", async () => {
      const bom = "﻿";
      const aPath = join(tempDir, "bom_a.csv");
      const bPath = join(tempDir, "bom_b.csv");
      await writeFile(aPath, bom + "lemma,flags\nrun,1\n", "utf-8");
      await writeFile(bPath, bom + "lemma,flags\ncat,0\n", "utf-8");

      const { stdout, error } = await runCaptureStdout([
        "node",
        "word-radar",
        "merge",
        aPath,
        bPath,
      ]);

      expect(error).toBeUndefined();
      expect(stdout).toMatch(/run,1/);
      expect(stdout).toMatch(/cat,0/);
    });
  });

  describe("bad row in input", () => {
    it("reports filename and line number, exits non-zero", async () => {
      const good = await writeCsv("good.csv", "lemma,flags\ncat,0\n");
      const bad = await writeCsv(
        "bad.csv",
        "lemma,flags\nrun,not-a-number\n",
      );

      const writes: string[] = [];
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        return true;
      }) as typeof process.stderr.write;

      try {
        await expect(
          run(["node", "word-radar", "merge", good, bad]),
        ).rejects.toThrow();
      } finally {
        process.stderr.write = originalStderr;
      }

      const stderr = writes.join("");
      // Should mention the file name
      expect(stderr).toContain("bad.csv");
      // Should mention the line number from core (line 2)
      expect(stderr).toMatch(/line 2/);
    });
  });

  describe("non-existent input file", () => {
    it("exits with error when an input file does not exist", async () => {
      const good = await writeCsv("good.csv", "lemma,flags\ncat,0\n");
      const nonExistent = join(tempDir, "no-such-file.csv");

      const writes: string[] = [];
      const originalStderr = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        return true;
      }) as typeof process.stderr.write;

      try {
        await expect(
          run(["node", "word-radar", "merge", good, nonExistent]),
        ).rejects.toThrow();
      } finally {
        process.stderr.write = originalStderr;
      }

      const stderr = writes.join("");
      expect(stderr).toMatch(/no-such-file\.csv/);
    });
  });

  describe("command validation", () => {
    it("exits with error when called with fewer than 2 files", async () => {
      await expect(
        run(["node", "word-radar", "merge", "only-one.csv"]),
      ).rejects.toThrow();
    });

    it("exits with error when called with no files", async () => {
      await expect(
        run(["node", "word-radar", "merge"]),
      ).rejects.toThrow();
    });
  });
});
