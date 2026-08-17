/**
 * WordRadar CLI 入口。占位实现：仅暴露 `hello` 与 `version`，
 * 后续工单会接上 `extract <file|dir>` 与 `merge <a.csv> <b.csv>`。
 *
 * 真正的 `parseAsync` 触发由打包产物顶部由 tsup 添加的 shebang 引导
 * （`#!/usr/bin/env node`）；不在 import 时副作用执行。
 */
import { Command } from "commander";
import { CORE_VERSION } from "@word-radar/core";

const program = new Command();

program
  .name("word-radar")
  .description("单词雷达 CLI — 清洗本地英文文本 / 合并词表")
  .version(CORE_VERSION);

program
  .command("hello")
  .description("占位命令，验证脚手架可跑通")
  .argument("[name]", "问候对象", "world")
  .action((name: string) => {
    process.stdout.write(`hello, ${name}!\n`);
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