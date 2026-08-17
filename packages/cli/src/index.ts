/**
 * WordRadar CLI 入口。
 *
 * 提供命令：
 * - extract <file|dir>: 从文件或目录提取词表
 * - merge <a.csv> <b.csv>: 合并词表（T06 实现）
 *
 * 真正的 `parseAsync` 触发由打包产物顶部由 tsup 添加的 shebang 引导
 * （`#!/usr/bin/env node`）；不在 import 时副作用执行。
 */
import { Command } from "commander";
import { CORE_VERSION } from "@word-radar/core";
import { processInput } from "./extract.js";
import { mergeFiles } from "./merge.js";

const program = new Command();

// 在测试环境（vitest）中，让 commander 抛出错误而不是调用 process.exit
// 这样测试可以捕获错误
program.exitOverride();

program
  .name("word-radar")
  .description("单词雷达 CLI — 清洗本地英文文本 / 合并词表")
  .version(CORE_VERSION);

program
  .command("extract <path>")
  .description(
    "从文件或目录提取英文单词，生成 CSV 词表。\n\n" +
      "对单个文件：<file> → <file>.words.csv\n" +
      "对目录：递归处理所有 .md/.txt 文件，每个文件生成一份输出。\n\n" +
      "输出文件默认放在输入文件同目录；使用 -o/--out 指定单文件输出路径。\n\n" +
      "处理进度会实时输出到 stderr。忽略隐藏文件（以 . 开头）和 node_modules 目录。",
  )
  .option("-o, --out <file>", "输出文件路径（仅单文件时有效）")
  .action(async (path: string, options: { out?: string }) => {
    await processInput(path, options);
  });

program
  .command("merge <csv...>")
  .description(
    "合并多份 CSV 词表并去重，同词 flags 按位 OR。\n\n" +
      "汇总不同来源时，任何来源里已推的词不会被洗回待推。\n\n" +
      "结果默认打印到 stdout；使用 -o/--out 写入文件。\n\n" +
      "输入含坏行时报出文件名与行号，命令非零退出。",
  )
  .option("-o, --out <file>", "输出文件路径（默认输出到 stdout）")
  .action(async (csvFiles: string[], options: { out?: string }) => {
    await mergeFiles(csvFiles, options);
  });

/**
 * 暴露给测试与上层调用方；不在 import 时主动跑。
 */
export async function run(argv: readonly string[]): Promise<void> {
  await program.parseAsync(argv);
}

/**
 * 直接被 `node dist/index.js` 调用时（pnpm bin 链接会带上入口点）才执行；
 * vitest 等 import 场景不会触发。
 */
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  run(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`word-radar: ${message}\n`);
    process.exitCode = 1;
  });
}