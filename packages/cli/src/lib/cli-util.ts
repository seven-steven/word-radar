/**
 * CLI 内部共享工具：extract / merge 共用的错误标记与 BOM 剥离。
 */
import { readFile } from "node:fs/promises";

/**
 * 标记错误已经由命令实现打印到 stderr，
 * 避免 index.ts 的 catch 再次打印。
 */
export function markPrinted(err: Error): Error {
  (err as Error & { alreadyPrinted?: boolean }).alreadyPrinted = true;
  return err;
}

/**
 * 读取文件并剥离 UTF-8 BOM（如果有）。
 */
export async function readTextWithoutBom(path: string): Promise<string> {
  const content = (await readFile(path)).toString("utf-8");
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
