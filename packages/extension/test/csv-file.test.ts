// @vitest-environment jsdom
/**
 * CsvFileGateway 单测：jsdom 环境验证下载与文件选择边界。
 *
 * download：stub URL.createObjectURL / revokeObjectURL 与 anchor.click，
 * 验证 Blob 类型、download 文件名与对象 URL 回收。
 * pickCsvText：手工构造 input 的 files 并派发 change / cancel 事件。
 * pickUploadFiles（issue #38 v1.1-T1；code-review P0 改回 File[]）：多选
 * 整批返回 File 列表，不读文本不预处理。readUploadFiles：逐文件读文本 +
 * html/xml 经 htmlToVisibleText 预处理为纯文本。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCsvFileGateway } from "../src/lib/csv-file.js";
import { UPLOAD_TEXT_SUFFIXES } from "../src/lib/messages.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * 拦截 document.createElement("input") 返回受控 input（click 不弹窗），
 * 测试体拿到 input 后手工派发 change / cancel 事件。
 */
function trapFileInput(): () => HTMLInputElement {
  const originalCreate = document.createElement.bind(document);
  let input!: HTMLInputElement;
  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: unknown) => {
      const el = originalCreate(tagName, options as never);
      if (tagName === "input") {
        input = el as HTMLInputElement;
        vi.spyOn(input, "click").mockImplementation(() => undefined);
      }
      return el;
    }) as typeof document.createElement,
  );
  return () => input;
}

describe("browserCsvFileGateway.download", () => {
  it("创建 Blob 下载链接：download 属性为文件名，点击后回收对象 URL", () => {
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    browserCsvFileGateway.download("word-radar.csv", "lemma,flags\nrun,0\n");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});

describe("browserCsvFileGateway.pickCsvText", () => {
  it("用户选择文件后读出 {name,text}", async () => {
    const getInput = trapFileInput();

    const promise = browserCsvFileGateway.pickCsvText();
    const input = getInput();
    expect(input.type).toBe("file");
    expect(input.accept).toContain(".csv");

    const file = new File(["lemma,flags\nrun,0\n"], "words.csv", {
      type: "text/csv",
    });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));

    await expect(promise).resolves.toEqual({
      name: "words.csv",
      text: "lemma,flags\nrun,0\n",
    });
  });

  it("用户取消选择时 resolve null", async () => {
    const getInput = trapFileInput();

    const promise = browserCsvFileGateway.pickCsvText();
    getInput().dispatchEvent(new Event("cancel"));

    await expect(promise).resolves.toBeNull();
  });

  it("change 但无文件时 resolve null", async () => {
    const getInput = trapFileInput();

    const promise = browserCsvFileGateway.pickCsvText();
    const input = getInput();
    Object.defineProperty(input, "files", { value: [] });
    input.dispatchEvent(new Event("change"));

    await expect(promise).resolves.toBeNull();
  });
});

describe("browserCsvFileGateway.pickUploadFiles（issue #24 验收修订；#38 多文件批；code-review P0 改回 File[]）", () => {
  it("accept 过滤覆盖 UPLOAD_TEXT_SUFFIXES 全部后缀（与 SW 校验共用同一常量）", async () => {
    const getInput = trapFileInput();

    const promise = browserCsvFileGateway.pickUploadFiles();
    const input = getInput();
    const accept = input.accept;
    // 后缀清单随常量自动扩展（issue #38 扩至 17 项），不再手写清单
    for (const suffix of UPLOAD_TEXT_SUFFIXES) {
      expect(accept).toContain(`.${suffix}`);
    }

    // 结束 promise（避免悬挂）：模拟用户取消
    input.dispatchEvent(new Event("cancel"));
    await expect(promise).resolves.toBeNull();
  });

  it("多选：input.multiple 开启，选择多个文件按序返回 File[]（不读文本不预处理）", async () => {
    const getInput = trapFileInput();

    const promise = browserCsvFileGateway.pickUploadFiles();
    const input = getInput();
    expect(input.multiple).toBe(true);

    const files = [
      new File(["run and"], "a.txt", { type: "text/plain" }),
      new File(["jump"], "b.md", { type: "text/markdown" }),
    ];
    Object.defineProperty(input, "files", { value: files });
    input.dispatchEvent(new Event("change"));

    // code-review P0：选完即回 File 对象，读取下沉到 readUploadFiles——
    // 点击路径因此与拖放共享 filterUploadFiles 闸门（此前绕过白名单/双上限）
    await expect(promise).resolves.toEqual(files);
  });

  it("用户取消选择时 resolve null", async () => {
    const getInput = trapFileInput();

    const promise = browserCsvFileGateway.pickUploadFiles();
    getInput().dispatchEvent(new Event("cancel"));

    await expect(promise).resolves.toBeNull();
  });
});

describe("browserCsvFileGateway.readUploadFiles（读取 + html/xml 预处理，code-review P0）", () => {
  it("html 文件在 popup 侧预处理为纯文本：script/style 文本不进结果（issue #38 决议 A2）", async () => {
    const html = [
      "<html><head><style>.ghoststyle{color:red}</style></head><body>",
      "<article><p>alpha bravo</p><script>var ghostToken = 1;</script></article>",
      "</body></html>",
    ].join("");
    const file = new File([html], "page.html", { type: "text/html" });

    const picked = await browserCsvFileGateway.readUploadFiles([file]);
    expect(picked).toHaveLength(1);
    expect(picked?.[0]?.name).toBe("page.html");
    expect(picked?.[0]?.text).toContain("alpha bravo");
    expect(picked?.[0]?.text).not.toContain("ghostToken");
    expect(picked?.[0]?.text).not.toContain("ghoststyle");
  });

  it("纯文本文件不经预处理，原样直读", async () => {
    const file = new File(["<p>not processed</p>"], "notes.txt", {
      type: "text/plain",
    });

    // .txt 不做 DOMParser 预处理：尖括号原文保留（闸门只对 .html/.xml）
    await expect(browserCsvFileGateway.readUploadFiles([file])).resolves.toEqual([
      { name: "notes.txt", text: "<p>not processed</p>" },
    ]);
  });

  it("任一文件读取失败 → 整批 resolve null（与既有失败语义一致）", async () => {
    const ok = new File(["fine"], "ok.txt", { type: "text/plain" });
    const bad = new File(["boom"], "bad.txt", { type: "text/plain" });
    const original = FileReader.prototype.readAsText;
    vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (
      this: FileReader,
      blob: Blob,
    ) {
      if (blob === bad) {
        // 模拟读取失败：派发 error 事件（readFileText 的 error 监听器 → null）
        this.dispatchEvent(new Event("error"));
        return;
      }
      return original.call(this, blob);
    });
    await expect(browserCsvFileGateway.readUploadFiles([ok, bad])).resolves.toBeNull();
  });
});
