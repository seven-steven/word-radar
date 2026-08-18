/**
 * merge 命令实现：合并多份 CSV 词表，同词 flags 按位 OR。
 */
import {
  mergeWordEntries,
  parseWordListCsv,
  stringifyWordListCsv,
} from "@word-radar/core";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { markPrinted, readTextWithoutBom } from "./lib/cli-util.js";

/**
 * 合并多份 CSV 词表文件。
 *
 * @param files - 输入 CSV 文件路径数组（至少 2 个）
 * @param options - 输出选项
 * @param options.out - 输出文件路径；省略则打印到 stdout
 */
export async function mergeFiles(
  files: string[],
  options?: { out?: string },
): Promise<void> {
  if (files.length < 2) {
    const message = "Error: merge requires at least 2 input files";
    process.stderr.write(`word-radar: ${message}\n`);
    throw markPrinted(new Error(message));
  }

  // 读取并解析所有输入文件
  const allEntries = [];
  for (const filePath of files) {
    const absolutePath = resolve(filePath);
    let content: string;
    try {
      // 读取（自动剥离 UTF-8 BOM）
      content = await readTextWithoutBom(absolutePath);
    } catch (error) {
      const message =
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? `Error: File not found: ${filePath}`
          : `Error: Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
      process.stderr.write(`word-radar: ${message}\n`);
      throw markPrinted(new Error(message));
    }

    // 解析 CSV，包装坏行错误以包含文件名
    let entries;
    try {
      entries = parseWordListCsv(content);
    } catch (error) {
      const originalMessage =
        error instanceof Error ? error.message : String(error);
      // core 报 "CSV parse error at line N: ..."，CLI 需包装文件名
      const message = `Error in ${filePath}: ${originalMessage}`;
      process.stderr.write(`word-radar: ${message}\n`);
      throw markPrinted(new Error(message));
    }

    allEntries.push(entries);
  }

  // 合并
  const merged = mergeWordEntries(...allEntries);

  // 序列化
  const csv = stringifyWordListCsv(merged);

  // 输出
  if (options?.out) {
    const outPath = resolve(options.out);
    await writeFile(outPath, csv, "utf-8");
    process.stderr.write(
      `Merged ${files.length} files → ${outPath} (${merged.length} words)\n`,
    );
  } else {
    process.stdout.write(csv);
  }
}
