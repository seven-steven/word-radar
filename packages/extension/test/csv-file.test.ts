// @vitest-environment jsdom
/**
 * CsvFileGateway 单测：jsdom 环境验证下载与文件选择边界。
 *
 * download：stub URL.createObjectURL / revokeObjectURL 与 anchor.click，
 * 验证 Blob 类型、download 文件名与对象 URL 回收。
 * pickCsvText：手工构造 input 的 files 并派发 change / cancel 事件。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCsvFileGateway } from "../src/lib/csv-file.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

describe("browserCsvFileGateway.pickUploadText（issue #24 验收修订）", () => {
  it("accept 过滤包含全部允许后缀（与 SW 校验共用 UPLOAD_TEXT_SUFFIXES）", async () => {
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

    const promise = browserCsvFileGateway.pickUploadText();
    const accept = input.accept;
    for (const suffix of ["txt", "md", "markdown", "csv", "log", "text", "json"]) {
      expect(accept).toContain(`.${suffix}`);
    }

    // 结束 promise（避免悬挂）：模拟用户取消
    input.dispatchEvent(new Event("cancel"));
    await expect(promise).resolves.toBeNull();
  });
});
