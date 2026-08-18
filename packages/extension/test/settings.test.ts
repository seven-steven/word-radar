/**
 * settings（自动推送开关）单测：默认开、布尔透传、非布尔视为默认开、写入透传。
 */
import { describe, expect, it, vi } from "vitest";
import { readAutoPush, writeAutoPush, type SettingsStorage } from "../src/lib/settings.js";

function makeStorage(initial: unknown = undefined): SettingsStorage & {
  getAutoPush: ReturnType<typeof vi.fn>;
  setAutoPush: ReturnType<typeof vi.fn>;
} {
  let value = initial;
  return {
    getAutoPush: vi.fn(async () => value),
    setAutoPush: vi.fn(async (next: boolean) => {
      value = next;
    }),
  };
}

describe("自动推送开关（chrome.storage.local）", () => {
  it("未设置时默认开（true）", async () => {
    const storage = makeStorage(undefined);
    await expect(readAutoPush(storage)).resolves.toBe(true);
  });

  it("存储为 false 时读到 false", async () => {
    const storage = makeStorage(false);
    await expect(readAutoPush(storage)).resolves.toBe(false);
  });

  it("存储为 true 时读到 true", async () => {
    const storage = makeStorage(true);
    await expect(readAutoPush(storage)).resolves.toBe(true);
  });

  it("存储值类型异常（如字符串）时按默认开处理", async () => {
    const storage = makeStorage("off");
    await expect(readAutoPush(storage)).resolves.toBe(true);
  });

  it("writeAutoPush 写入布尔值", async () => {
    const storage = makeStorage(undefined);
    await writeAutoPush(false, storage);
    expect(storage.setAutoPush).toHaveBeenCalledWith(false);
    await expect(readAutoPush(storage)).resolves.toBe(false);
  });
});
