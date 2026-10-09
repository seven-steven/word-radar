// @vitest-environment jsdom
/**
 * 确认卡生命周期 module 单测（issue #54 Wave E）：render / 快照记账 /
 * 失败恢复 / 消费清空从 popup.ts DOM 胶水收进 src/lib/confirm-card.ts
 * 后的可测矩阵。
 *
 * 覆盖行为合同（逐字保持自 popup 原实现）：
 * - render：summary/filtered(>0 与 =0)/meta 的文本与 hidden、reveal 开、
 *   pushButton 聚焦并解禁、快照记录、onRendered 联动。
 * - hide：reveal 关、卡内焦点回收至 focusReturnTarget（卡外焦点不抢）、
 *   onHidden 联动。
 * - restoreFromSnapshot：有快照重渲快照内容返回 true；无快照 false 不渲染。
 * - consume：快照清空——后续 restore 恒 false（#22 快照残留恢复已消费旧卡）。
 * - DOM 网关可空（popup 的 querySelector 习惯）：null 防御分支不抛。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConfirmCard,
  type ConfirmCardDom,
  type ConfirmCardHooks,
  type ConfirmCardTexts,
} from "../src/lib/confirm-card.js";

function makeDom(): ConfirmCardDom {
  document.body.innerHTML = `
    <button data-testid="collect"></button>
    <section class="reveal" data-testid="confirm-section">
      <p data-testid="confirm-summary"></p>
      <p data-testid="confirm-filtered" hidden></p>
      <p data-testid="confirm-meta" hidden></p>
      <button data-testid="confirm-push"></button>
    </section>`;
  return {
    section: document.querySelector<HTMLElement>('[data-testid="confirm-section"]'),
    summary: document.querySelector<HTMLElement>('[data-testid="confirm-summary"]'),
    filtered: document.querySelector<HTMLElement>('[data-testid="confirm-filtered"]'),
    meta: document.querySelector<HTMLElement>('[data-testid="confirm-meta"]'),
    pushButton: document.querySelector<HTMLButtonElement>('[data-testid="confirm-push"]'),
    focusReturnTarget: document.querySelector<HTMLElement>('[data-testid="collect"]'),
  };
}

function makeTexts(): ConfirmCardTexts {
  return {
    source: (key) => `src:${key}`,
    summary: (source, total, newCount) => `sum(${source},${total},${newCount})`,
    filtered: (count) => `filtered(${count})`,
  };
}

function makeHooks(): ConfirmCardHooks {
  return { onRendered: vi.fn(), onHidden: vi.fn() };
}

const COLLECT_CARD = {
  sourceKey: "sourceCollect",
  total: 12,
  newCount: 3,
  filteredCount: 4,
} as const;

const UPLOAD_CARD = {
  sourceKey: "sourceUpload",
  total: 20,
  newCount: 5,
  meta: "已替换 · 已收录 2 个文件",
  filteredCount: 1,
} as const;

describe("confirm-card module（#54 Wave E）", () => {
  let dom: ConfirmCardDom;
  let hooks: ConfirmCardHooks;

  beforeEach(() => {
    dom = makeDom();
    hooks = makeHooks();
  });

  it("render：全字段呈现，reveal 开，pushButton 聚焦解禁，快照记录，onRendered 调用", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    const pushButton = dom.pushButton!;

    pushButton.disabled = true;
    card.render({ ...UPLOAD_CARD });

    expect(dom.summary?.textContent).toBe("sum(src:sourceUpload,20,5)");
    expect(dom.filtered?.textContent).toBe("filtered(1)");
    expect(dom.filtered?.hidden).toBe(false);
    expect(dom.meta?.textContent).toBe(UPLOAD_CARD.meta);
    expect(dom.meta?.hidden).toBe(false);
    expect(dom.section?.classList.contains("open")).toBe(true);
    expect(pushButton.disabled).toBe(false);
    expect(document.activeElement).toBe(pushButton);
    expect(card.snapshot()).toEqual({ ...UPLOAD_CARD });
    expect(card.isVisible()).toBe(true);
    expect(hooks.onRendered).toHaveBeenCalledTimes(1);
    expect(hooks.onHidden).not.toHaveBeenCalled();
  });

  it("render：filteredCount=0 → filtered 行隐藏且文本清空（>0 才渲染）", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    card.render({ sourceKey: "sourceImport", total: 7, newCount: 2, filteredCount: 0 });

    expect(dom.filtered?.textContent).toBe("");
    expect(dom.filtered?.hidden).toBe(true);
  });

  it("render：缺省 filteredCount（CSV 导入）同 =0 隐藏；缺省 meta → meta 行隐藏", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    card.render({ sourceKey: "sourceImport", total: 7, newCount: 2 });

    expect(dom.filtered?.hidden).toBe(true);
    expect(dom.meta?.textContent).toBe("");
    expect(dom.meta?.hidden).toBe(true);
  });

  it("hide：reveal 关，卡内焦点回收至 focusReturnTarget，onHidden 调用", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    card.render({ ...COLLECT_CARD });
    dom.pushButton!.focus();

    card.hide();

    expect(dom.section?.classList.contains("open")).toBe(false);
    expect(document.activeElement).toBe(dom.focusReturnTarget);
    expect(card.isVisible()).toBe(false);
    expect(hooks.onHidden).toHaveBeenCalledTimes(1);
    // hide 不动快照：失败恢复分支语义依赖此点（#22 的反面——恢复在 consume 前）
    expect(card.snapshot()).toEqual({ ...COLLECT_CARD });
  });

  it("hide：焦点在卡外 → 不抢焦点", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    card.render({ ...COLLECT_CARD });
    (dom.focusReturnTarget as HTMLElement).focus();

    card.hide();

    expect(document.activeElement).toBe(dom.focusReturnTarget);
    expect(dom.section?.classList.contains("open")).toBe(false);
  });

  it("restoreFromSnapshot：有快照 → true 且重渲快照内容（最新一张）", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    card.render({ ...COLLECT_CARD });
    card.render({ ...UPLOAD_CARD });
    card.hide();
    hooks.onRendered.mockClear();

    expect(card.restoreFromSnapshot()).toBe(true);
    expect(hooks.onRendered).toHaveBeenCalledTimes(1);
    expect(dom.summary?.textContent).toBe("sum(src:sourceUpload,20,5)");
    expect(dom.meta?.textContent).toBe(UPLOAD_CARD.meta);
    expect(dom.section?.classList.contains("open")).toBe(true);
  });

  it("restoreFromSnapshot：无快照 → false 且不渲染", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);

    expect(card.restoreFromSnapshot()).toBe(false);
    expect(hooks.onRendered).not.toHaveBeenCalled();
    expect(dom.summary?.textContent).toBe("");
    expect(dom.section?.classList.contains("open")).toBe(false);
  });

  it("consume：快照清空，restore 恒 false 且不渲染（#22 快照残留）", () => {
    const card = createConfirmCard(dom, makeTexts(), hooks);
    card.render({ ...COLLECT_CARD });
    card.consume();
    card.hide();
    hooks.onRendered.mockClear();

    expect(card.snapshot()).toBeNull();
    expect(card.restoreFromSnapshot()).toBe(false);
    expect(hooks.onRendered).not.toHaveBeenCalled();
    // 收起态保持：consume 不改变可见性，恢复也不会把已消费的卡拉回来
    expect(dom.section?.classList.contains("open")).toBe(false);
  });

  it("防御：section/pushButton/focusReturnTarget 为 null 不抛", () => {
    const bare = createConfirmCard(
      { section: null, summary: null, filtered: null, meta: null, pushButton: null, focusReturnTarget: null },
      makeTexts(),
      hooks,
    );

    expect(() => bare.render({ ...COLLECT_CARD })).not.toThrow();
    expect(bare.isVisible()).toBe(false);
    expect(() => bare.hide()).not.toThrow();
    expect(() => bare.restoreFromSnapshot()).not.toThrow();
    // render 与 restore 各渲染一次：防御路径不吞 hooks 联动
    expect(hooks.onRendered).toHaveBeenCalledTimes(2);
    expect(hooks.onHidden).toHaveBeenCalledTimes(1);
  });
});
