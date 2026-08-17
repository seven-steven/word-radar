import { describe, expect, it, vi } from "vitest";
import { fetchCounts, fetchLoginStatus, type SwChannel } from "../src/lib/sw-channel.js";

function fakeChannel(overrides: Partial<SwChannel> = {}): SwChannel {
  return {
    getCounts: vi.fn(async () => ({ total: 7, pending: 4 })),
    markPushed: vi.fn(async () => ({ total: 7, pending: 3 })),
    checkLogin: vi.fn(async () => ({ loggedIn: true })),
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