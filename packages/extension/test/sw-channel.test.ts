import { describe, expect, it, vi } from "vitest";
import {
  fetchCounts,
  fetchExportCsv,
  fetchLoginStatus,
  importCsv,
  type SwChannel,
} from "../src/lib/sw-channel.js";

function fakeChannel(overrides: Partial<SwChannel> = {}): SwChannel {
  return {
    getCounts: vi.fn(async () => ({ total: 7, pending: 4 })),
    markPushed: vi.fn(async () => ({ total: 7, pending: 3 })),
    checkLogin: vi.fn(async () => ({ loggedIn: true })),
    getPushStatus: vi.fn(async () => ({
      phase: "idle",
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    })),
    retryPush: vi.fn(async () => undefined),
    exportCsv: vi.fn(async () => ({ ok: true, csv: "lemma,flags\nrun,0\n" })),
    importCsv: vi.fn(async () => ({ total: 8, newCount: 5 })),
    ...overrides,
  };
}

describe("fetchCounts（popup 侧）", () => {
  it("向 SW 查 GET_COUNTS 并透传 Counts", async () => {
    const channel = fakeChannel();

    const counts = await fetchCounts(channel);

    expect(channel.getCounts).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ total: 7, pending: 4 });
  });

  it("SW 应答畸形（缺字段）时归一为 null", async () => {
    const channel = fakeChannel({
      getCounts: vi.fn(async () => ({ total: 1 })),
    });

    expect(await fetchCounts(channel)).toBeNull();
  });

  it("SW 应答非对象时归一为 null", async () => {
    const channel = fakeChannel({
      getCounts: vi.fn(async () => "garbage"),
    });

    expect(await fetchCounts(channel)).toBeNull();
  });

  it("sendMessage 抛错（SW 未启动）时归一为 null，不传播", async () => {
    const channel = fakeChannel({
      getCounts: vi.fn(async () => {
        throw new Error("Could not establish connection");
      }),
    });

    expect(await fetchCounts(channel)).toBeNull();
  });
});

describe("fetchLoginStatus（popup 侧）", () => {
  it("向 SW 发 CHECK_LOGIN 并透传 loggedIn=true", async () => {
    const channel = fakeChannel();

    const status = await fetchLoginStatus(channel);

    expect(channel.checkLogin).toHaveBeenCalledTimes(1);
    expect(status).toEqual({ loggedIn: true });
  });

  it("SW 报 loggedIn=false 时原样返回（视为未登录）", async () => {
    const channel = fakeChannel({
      checkLogin: vi.fn(async () => ({ loggedIn: false })),
    });

    expect(await fetchLoginStatus(channel)).toEqual({ loggedIn: false });
  });

  it("SW 应答畸形（缺 loggedIn 字段）时归一为 loggedIn=false（保守）", async () => {
    const channel = fakeChannel({
      checkLogin: vi.fn(async () => ({ ok: true, count: 1 })),
    });

    expect(await fetchLoginStatus(channel)).toEqual({ loggedIn: false });
  });

  it("SW 应答非对象时归一为 loggedIn=false", async () => {
    const channel = fakeChannel({
      checkLogin: vi.fn(async () => "yes"),
    });

    expect(await fetchLoginStatus(channel)).toEqual({ loggedIn: false });
  });

  it("sendMessage 抛错（SW 未启动）时归一为 loggedIn=false，不传播", async () => {
    const channel = fakeChannel({
      checkLogin: vi.fn(async () => {
        throw new Error("Could not establish connection");
      }),
    });

    expect(await fetchLoginStatus(channel)).toEqual({ loggedIn: false });
  });
});

describe("fetchExportCsv（popup 侧）", () => {
  it("向 SW 发 EXPORT_CSV 并透传 {ok:true,csv}", async () => {
    const channel = fakeChannel();

    const outcome = await fetchExportCsv(channel);

    expect(channel.exportCsv).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true, csv: "lemma,flags\nrun,0\n" });
  });

  it("SW 报 {ok:false,error} 时原样透传", async () => {
    const channel = fakeChannel({
      exportCsv: vi.fn(async () => ({ ok: false, error: "export-failed" })),
    });

    expect(await fetchExportCsv(channel)).toEqual({
      ok: false,
      error: "export-failed",
    });
  });

  it("SW 应答畸形时归一为 {ok:false}", async () => {
    const channel = fakeChannel({
      exportCsv: vi.fn(async () => "garbage"),
    });

    const outcome = await fetchExportCsv(channel);
    expect(outcome.ok).toBe(false);
  });

  it("sendMessage 抛错时归一为 {ok:false}，不传播", async () => {
    const channel = fakeChannel({
      exportCsv: vi.fn(async () => {
        throw new Error("Could not establish connection");
      }),
    });

    const outcome = await fetchExportCsv(channel);
    expect(outcome.ok).toBe(false);
  });
});

describe("importCsv（popup 侧）", () => {
  it("向 SW 发 IMPORT_CSV（带文本与文件名）并把 BatchPreview 包成 {ok:true,total,newCount}", async () => {
    const channel = fakeChannel();

    const outcome = await importCsv(channel, "lemma,flags\nrun,0\n", "words.csv");

    expect(channel.importCsv).toHaveBeenCalledWith(
      "lemma,flags\nrun,0\n",
      "words.csv",
    );
    // review S-3：导入应答是待确认批次预览，不再是合并后的 Counts
    expect(outcome).toEqual({ ok: true, total: 8, newCount: 5 });
  });

  it("SW 报 {ok:false,error}（坏 CSV）时原样透传错误", async () => {
    const channel = fakeChannel({
      importCsv: vi.fn(async () => ({
        ok: false,
        error: "bad.csv: CSV parse error at line 3: empty lemma",
      })),
    });

    const outcome = await importCsv(channel, "garbage", "bad.csv");
    expect(outcome).toEqual({
      ok: false,
      error: "bad.csv: CSV parse error at line 3: empty lemma",
    });
  });

  it("SW 应答畸形时归一为 {ok:false}", async () => {
    const channel = fakeChannel({
      importCsv: vi.fn(async () => ({ total: "x" })),
    });

    const outcome = await importCsv(channel, "lemma,flags\n", "a.csv");
    expect(outcome.ok).toBe(false);
  });

  it("sendMessage 抛错时归一为 {ok:false}，不传播", async () => {
    const channel = fakeChannel({
      importCsv: vi.fn(async () => {
        throw new Error("Could not establish connection");
      }),
    });

    const outcome = await importCsv(channel, "lemma,flags\n", "a.csv");
    expect(outcome.ok).toBe(false);
  });
});