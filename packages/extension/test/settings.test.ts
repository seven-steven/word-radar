/**
 * settings 单测：「自动推送」开关已彻底移除（issue #22），本模块负责
 * 清理旧存储键 `autoPush`（幂等）+ 收词过滤两开关的读写（issue #43）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_ABBREVIATIONS_KEY,
  FILTER_CONTRACTIONS_KEY,
  LEGACY_AUTO_PUSH_KEY,
  cleanupLegacyAutoPush,
  getIntakeFilterSettings,
  setIntakeFilterSetting,
  type SettingsStorage,
} from "../src/lib/settings.js";

function makeStorage(): SettingsStorage & {
  remove: ReturnType<typeof vi.fn>;
} {
  return { remove: vi.fn(async () => undefined) };
}

describe("cleanupLegacyAutoPush（旧存储键清理）", () => {
  it("对默认网关调用 remove(\"autoPush\")", async () => {
    const storage = makeStorage();
    await cleanupLegacyAutoPush(storage);
    expect(storage.remove).toHaveBeenCalledWith(LEGACY_AUTO_PUSH_KEY);
    expect(LEGACY_AUTO_PUSH_KEY).toBe("autoPush");
  });

  it("remove 抛错时异常透出，由调用方（background.ts 顶层 void）兜底", async () => {
    const storage = makeStorage();
    storage.remove = vi.fn(async () => {
      throw new Error("storage boom");
    });
    await expect(cleanupLegacyAutoPush(storage)).rejects.toThrow("storage boom");
  });
});

describe("收词过滤开关读写（issue #43）", () => {
  /** 可观察读写的 storage 假件：内存 Map 支撑，get 缺键返回 undefined。 */
  function makeMapStorage(): SettingsStorage & {
    remove: ReturnType<typeof vi.fn>;
    map: Map<string, unknown>;
  } {
    const map = new Map<string, unknown>();
    return {
      map,
      remove: vi.fn(async (key: string) => {
        map.delete(key);
      }),
      get: vi.fn(async (key: string) => map.get(key)),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) map.set(key, value);
      }),
    };
  }

  it("键缺失（从未写过）时读值兜底 true——缺省即全开，不写默认值进 storage", async () => {
    const storage = makeMapStorage();

    const settings = await getIntakeFilterSettings(storage);

    expect(settings).toEqual({ filterAbbreviations: true, filterContractions: true });
    expect(storage.set).not.toHaveBeenCalled(); // 读路径不写
  });

  it("分别关闭后读值如实返回", async () => {
    const storage = makeMapStorage();
    await setIntakeFilterSetting("filterAbbreviations", false, storage);

    expect(await getIntakeFilterSettings(storage)).toEqual({
      filterAbbreviations: false,
      filterContractions: true,
    });

    await setIntakeFilterSetting("filterContractions", false, storage);

    expect(await getIntakeFilterSettings(storage)).toEqual({
      filterAbbreviations: false,
      filterContractions: false,
    });
  });

  it("写通道按单键写回（键名即 storage 键）", async () => {
    const storage = makeMapStorage();

    await setIntakeFilterSetting("filterAbbreviations", false, storage);

    expect(storage.set).toHaveBeenCalledWith({ filterAbbreviations: false });
    expect(storage.map.get(FILTER_ABBREVIATIONS_KEY)).toBe(false);
    expect(storage.map.has(FILTER_CONTRACTIONS_KEY)).toBe(false);
  });

  it("脏数据（非 boolean）按 true 兜底，不透传任意值", async () => {
    const storage = makeMapStorage();
    storage.map.set(FILTER_ABBREVIATIONS_KEY, "false");
    storage.map.set(FILTER_CONTRACTIONS_KEY, 0);

    const settings = await getIntakeFilterSettings(storage);

    expect(settings).toEqual({ filterAbbreviations: true, filterContractions: true });
  });

  it("get 抛错时异常透出，由调用方（popup boot / 提取路径）决定降级", async () => {
    const storage = makeMapStorage();
    storage.get = vi.fn(async () => {
      throw new Error("storage boom");
    });
    await expect(getIntakeFilterSettings(storage)).rejects.toThrow("storage boom");
  });
});
