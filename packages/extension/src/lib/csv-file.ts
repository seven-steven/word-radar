/**
 * popup 侧的本地文件边界（T11）：CSV 下载与文件选择。
 *
 * 全部 DOM / Blob / FileReader 操作收在这一个小模块，popup 只依赖可注入的
 * CsvFileGateway，便于单测与未来替换实现（如 chrome.downloads）。
 *
 * 不需要额外 manifest 权限：Blob + a[download] 的浏览器下载与
 * <input type=file> 的文件选择均属于页面级能力。
 */
export interface CsvFileGateway {
  /** 把文本保存为本地文件（触发浏览器下载）。 */
  download(filename: string, text: string): void;
  /**
   * 弹出文件选择器让用户挑一份 CSV，读出文本后 resolve {name,text}；
   * 用户取消 / 未选文件 / 读取失败时 resolve null。
   */
  pickCsvText(): Promise<{ name: string; text: string } | null>;
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
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv";
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
  },
};
