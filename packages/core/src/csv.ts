import type { WordEntry } from "./types.js";

/**
 * 解析两列 CSV 文本为 WordEntry 数组。
 * 第一行为表头 "lemma,flags"（校验但宽容：不强制大小写）。
 * 坏行（缺列、非数字 flags、空 lemma 等）抛出带行号的 Error。
 * 空输入返回空数组。
 * 支持 CRLF / LF 混合行尾、trailing 空行、RFC 4180 引号转义（含引号内换行）。
 */
export function parseWordListCsv(text: string): WordEntry[] {
  if (text.length === 0) return [];

  // 统一 CRLF → LF
  const normalized = text.replace(/\r\n/g, "\n");
  const rows = splitLogicalRows(normalized);

  if (rows.length === 0) return [];

  // 跳过表头（行号 1），从行号 2 开始解析数据
  const entries: WordEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const lineNum = row.lineNum;
    const fields = parseCsvRowFields(row.content);

    if (fields.length !== 2) {
      throw new Error(
        `CSV parse error at line ${lineNum}: expected 2 columns, got ${fields.length}`,
      );
    }

    const rawLemma = fields[0]!.trim();
    const rawFlags = fields[1]!.trim();

    if (rawLemma.length === 0) {
      throw new Error(`CSV parse error at line ${lineNum}: empty lemma`);
    }

    const lemma = rawLemma.toLowerCase();

    // flags 必须是非负整数
    if (!/^\d+$/.test(rawFlags)) {
      throw new Error(
        `CSV parse error at line ${lineNum}: flags must be a non-negative integer, got "${rawFlags}"`,
      );
    }

    const flags = Number(rawFlags);

    entries.push({ lemma, flags });
  }

  return entries;
}

/**
 * 将 WordEntry 数组序列化为两列 CSV 文本（带表头，LF 行尾）。
 * lemma 含逗号、双引号、换行时按 RFC 4180 转义。
 * 空输入返回仅表头行。
 */
export function stringifyWordListCsv(entries: WordEntry[]): string {
  const lines: string[] = ["lemma,flags"];
  for (const entry of entries) {
    lines.push(`${rfc4180Escape(entry.lemma)},${entry.flags}`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LogicalRow {
  /** 逻辑行在原始文本中的起始行号（1-based，基于物理行计数） */
  lineNum: number;
  /** 该逻辑行的内容（已拼接引号跨行部分） */
  content: string;
}

/**
 * 将文本拆分为逻辑行（考虑 RFC 4180 引号跨行）。
 * 行号基于物理行（遇到 \n 就计数），便于报错时定位到用户看到的行。
 */
function splitLogicalRows(text: string): LogicalRow[] {
  const rows: LogicalRow[] = [];
  let pos = 0;
  let physicalLine = 1; // 1-based

  while (pos < text.length) {
    const row = scanLogicalRow(text, pos, physicalLine);
    rows.push(row);
    const consumed = row.content.length;
    const newlineCount = countNewlines(row.content);
    // advance past the row content + the terminating \n
    pos += consumed + 1; // +1 for the \n that ended the row
    physicalLine += newlineCount + 1; // +1 for the terminating \n
  }

  // 去掉尾部空行（由 trailing \n 产生的空行）
  while (rows.length > 0 && rows[rows.length - 1]!.content.length === 0) {
    rows.pop();
  }

  return rows;
}

/**
 * 从 text[pos] 开始扫描一个逻辑行。
 * 如果行内含引号字段且字段内包含换行，则持续扫描到引号关闭再遇到行尾。
 */
function scanLogicalRow(
  text: string,
  pos: number,
  lineNum: number,
): LogicalRow {
  let i = pos;
  const len = text.length;
  let inQuotes = false;
  const chars: string[] = [];

  while (i < len) {
    const ch = text.charAt(i);

    if (inQuotes) {
      if (ch === '"') {
        const next = text.charAt(i + 1);
        if (next === '"') {
          // 转义双引号
          chars.push('""');
          i += 2;
        } else {
          // 结束引号
          inQuotes = false;
          chars.push('"');
          i++;
        }
      } else {
        chars.push(ch);
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        chars.push(ch);
        i++;
      } else if (ch === "\n") {
        // 非引号内的换行 = 逻辑行结束
        break;
      } else {
        chars.push(ch);
        i++;
      }
    }
  }

  return { lineNum, content: chars.join("") };
}

/**
 * 统计字符串中 \n 的数量。
 */
function countNewlines(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charAt(i) === "\n") count++;
  }
  return count;
}

/**
 * 解析单行 CSV 字段，处理 RFC 4180 引号。
 * 返回字段数组（已去除引号包裹，已反转义 "" → "）。
 */
function parseCsvRowFields(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;

  while (i <= len) {
    if (i === len) break;

    const ch = line.charAt(i);
    if (ch === '"') {
      const { value, endIndex } = parseQuotedField(line, i);
      fields.push(value);
      i = endIndex;
      if (i < len && line.charAt(i) === ",") {
        i++;
      }
      if (i === len) {
        fields.push("");
      }
    } else {
      let end = i;
      while (end < len && line.charAt(end) !== ",") {
        end++;
      }
      fields.push(line.slice(i, end));
      if (end < len && line.charAt(end) === ",") {
        end++;
        if (end === len) {
          fields.push("");
        }
      }
      i = end;
    }
  }

  return fields;
}

/**
 * 解析引号字段，从 start（指向开头的 "）开始。
 * 返回解引号、反转义后的值，以及字段结束后的索引。
 */
function parseQuotedField(
  line: string,
  start: number,
): { value: string; endIndex: number } {
  let i = start + 1;
  const len = line.length;
  const chars: string[] = [];

  while (i < len) {
    const ch = line.charAt(i);
    if (ch === '"') {
      const next = line.charAt(i + 1);
      if (next === '"') {
        chars.push('"');
        i += 2;
      } else {
        i++;
        break;
      }
    } else {
      chars.push(ch);
      i++;
    }
  }

  return { value: chars.join(""), endIndex: i };
}

/**
 * RFC 4180 字段转义：如果字段含逗号、双引号、换行，则包裹引号并转义内部双引号。
 */
function rfc4180Escape(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}
