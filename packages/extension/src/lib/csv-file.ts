/**
 * popup 侧的本地文件边界（T11）：CSV 下载与文件选择
 * （上传入口为多选，issue #38：整批 = 一次采集）。
 *
 * 全部 DOM / Blob / FileReader 操作收在这一个小模块，popup 只依赖可注入的
 * CsvFileGateway，便于单测与未来替换实现（如 chrome.downloads）。
 *
 * 不需要额外 manifest 权限：Blob + a[download] 的浏览器下载与
 * <input type=file> 的文件选择均属于页面级能力。
 */
import { UPLOAD_TEXT_SUFFIXES } from "./messages.js";
import { htmlToVisibleText } from "./html-text.js";

export interface CsvFileGateway {
  /** 把文本保存为本地文件（触发浏览器下载）。 */
  download(filename: string, text: string): void;
  /**
   * 弹出文件选择器让用户挑一份 CSV，读出文本后 resolve {name,text}；
   * 用户取消 / 未选文件 / 读取失败时 resolve null。
   */
  pickCsvText(): Promise<{ name: string; text: string } | null>;
  /**
   * 弹出文件选择器让用户挑若干份纯文本文件（issue #24 验收修订；
   * issue #38 v1.1-T1 改多选：一次操作的全部文件整批算一次采集），
   * 读出全部文本后 resolve 数组；html/xml 在这里预处理为纯文本——
   * DOMParser 是浏览器 API，SW 侧单测不 mock DOM（spec Testing Decisions），
   * 预处理必须发生在 popup 侧（html-text.ts）。用户取消 / 未选文件 /
   * 任一读取失败时 resolve null。
   */
  pickUploadText(): Promise<{ name: string; text: string }[] | null>;
}

export const browserCsvFileGateway: CsvFileGateway = {
  download(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  pickCsvText() {
    return pickTextFile(".csv,text/csv");
  },

  pickUploadText() {
    // 后缀清单与 SW 的 handleUploadFile 校验共用 UPLOAD_TEXT_SUFFIXES（17 项）；
    // MIME 只是兜底（系统未必标注 text/markdown 等），真正的闸门在 SW 后缀校验。
    // 注意：这里的 .csv 是当纯文本提词（自然语言提取管线），不是结构化导入。
    return pickTextFiles(
      `${UPLOAD_TEXT_SUFFIXES.map((suffix) => `.${suffix}`).join(",")},text/plain,text/markdown,text/csv`,
    ).then((picked) => {
      if (picked === null) return null;
      // html/xml 预处理（issue #38 决议 A2）：popup 侧 DOMParser→可见正文，
      // SW 收到的 text 一律当纯文本（DOMParser 是浏览器 API，SW 单测不 mock DOM）
      return picked.map((file) =>
        isMarkupUploadName(file.name)
          ? { ...file, text: htmlToVisibleText(file.text) }
          : file,
      );
    });
  },
};

/** .html/.xml 文件名判定（小写后缀）：上传批次里仅这两类需 popup 侧预处理。 */
function isMarkupUploadName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".xml");
}

/** 通用文本文件选择（单选）：accept 过滤 + FileReader 读文本，取消/失败 resolve null。 */
function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        resolve({ name: file.name, text: String(reader.result ?? "") });
      });
      reader.addEventListener("error", () => resolve(null));
      reader.readAsText(file);
    });
    // 用户在文件对话框点取消（Chrome 113+ 支持 cancel 事件）
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** FileReader 读单个文件文本；读取失败 resolve null。 */
function readFileText(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => resolve(null));
    reader.readAsText(file);
  });
}

/**
 * 通用文本文件选择（多选，issue #38）：accept 过滤 + multiple +
 * FileReader 逐文件读文本；任一文件读取失败 → 整批 resolve null
 * （与单选时代的失败语义一致）。取消 / 未选文件同样 resolve null。
 */
function pickTextFiles(accept: string): Promise<{ name: string; text: string }[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept;
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve(null);
        return;
      }
      // Promise.all 结果按输入顺序排列，保住用户选择顺序
      void Promise.all(files.map(readFileText)).then((texts) => {
        if (texts.some((text) => text === null)) {
          resolve(null);
          return;
        }
        resolve(files.map((file, index) => ({ name: file.name, text: texts[index] ?? "" })));
      });
    });
    // 用户在文件对话框点取消（Chrome 113+ 支持 cancel 事件）
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
