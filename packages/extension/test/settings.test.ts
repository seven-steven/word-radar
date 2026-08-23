/**
 * settings 单测（issue #22）：「自动推送」开关已彻底移除，本模块只负责
 * 清理旧存储键 `autoPush`（幂等）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_AUTO_PUSH_KEY,
  cleanupLegacyAutoPush,
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
