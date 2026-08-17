/**
 * extract 命令实现：文件/目录 → CSV 词表。
 */
import {
  extractWordEntries,
  stringifyWordListCsv,
  type ExtractOptions,
} from "@word-radar/core";
import {
  readFile,
  writeFile,
  stat,
  readdir,
  mkdir,
} from "node:fs/promises";
import { resolve, join, basename, dirname, extname } from "node:path";
import { relative } from "node:path";

/**
 * 处理单个输入路径（文件或目录）。
 */
export async function processInput(
  inputPath: string,
  options?: { out?: string },
): Promise<void> {
  const absolutePath = resolve(inputPath);
  let stats;

  try {
    stats = await stat(absolutePath);
  } catch (error) {
    const message =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? `Error: Path does not exist: ${inputPath}`
        : `Error: Cannot access ${inputPath}: ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`word-radar: ${message}\n`);
    throw new Error(message);
  }

  if (stats.isFile()) {
    await processFile(absolutePath, options?.out);
  } else if (stats.isDirectory()) {
    if (options?.out) {
      const message =
        "Error: Cannot use -o/--out when processing a directory. Output files will be placed alongside input files.";
      process.stderr.write(`word-radar: ${message}\n`);
      throw new Error(message);
    }
    await processDirectory(absolutePath);
  } else {
    const message = `Error: Not a file or directory: ${inputPath}`;
    process.stderr.write(`word-radar: ${message}\n`);
    throw new Error(message);
  }
}

/**
 * 处理单个文件。
 */
async function processFile(filePath: string, outPath?: string): Promise<void> {
  // 读取文件内容并 strip BOM
  const buffer = await readFile(filePath);
  let content = buffer.toString("utf-8");
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // 提取词条
  const entries = extractWordEntries(content);

  // 序列化为 CSV
  const csv = stringifyWordListCsv(entries);

  // 确定输出路径
  const outputPath = outPath || getDefaultOutputPath(filePath);

  // 确保输出目录存在
  const outputDir = dirname(outputPath);
  try {
    await mkdir(outputDir, { recursive: true });
  } catch {
    // 目录可能已存在，忽略错误
  }

  // 写入文件
  await writeFile(outputPath, csv, "utf-8");

  // 进度输出到 stderr
  process.stderr.write(
    `${relative(process.cwd(), filePath)} → ${relative(process.cwd(), outputPath)} (${entries.length} words)\n`,
  );
}

/**
 * 递归处理目录。
 */
async function processDirectory(dirPath: string): Promise<void> {
  const files = await collectFiles(dirPath);

  if (files.length === 0) {
    process.stderr.write(
      `word-radar: No .md or .txt files found in ${relative(process.cwd(), dirPath)}\n`,
    );
    return;
  }

  for (const file of files) {
    await processFile(file);
  }
}

/**
 * 收集目录下所有需要处理的文件（递归，忽略隐藏文件和 node_modules）。
 */
async function collectFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;

      // 忽略隐藏文件和目录
      if (name.startsWith(".")) {
        continue;
      }

      // 忽略 node_modules
      if (name === "node_modules") {
        continue;
      }

      const fullPath = join(currentPath, name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        // 只处理 .md 和 .txt 文件
        const ext = extname(name).toLowerCase();
        if (ext === ".md" || ext === ".txt") {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return files;
}

/**
 * 获取默认输出路径：<dir>/<basename>.words.csv
 */
function getDefaultOutputPath(filePath: string): string {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const dir = dirname(filePath);
  return join(dir, `${base}.words.csv`);
}