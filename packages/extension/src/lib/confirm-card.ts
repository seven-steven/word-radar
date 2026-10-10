/**
 * 确认卡生命周期 module（issue #54 Wave E）：render / 快照记账 / 失败恢复 /
 * 消费清空收进可单测的闭包——此前住在 popup.ts 的 DOM 胶水里，真实 bug
 * （code-review #22 快照残留恢复已消费旧卡）只能靠 e2e 抓。
 *
 * DOM 网关（ConfirmCardDom）与文案（ConfirmCardTexts）注入——jsdom 单测
 * 直接喂真实元素，popup 的 i18n 适配层只做参数转发；popup 级联动（状态行
 * 互斥、空态提示）经 ConfirmCardHooks 回调留在 popup（全局状态不搬）。
 *
 * reveal 开合（.open class）走 lib/reveal.ts 的 setRevealOpen/isRevealOpen
 * ——与 popup.ts / toolsPanel 同一出口，开合语义单点持有。
 * 焦点回收（hide 侧）：卡片持有焦点时收起会把焦点坠回 body——先归还给
 * 稳定入口（focusReturnTarget，popup 传 collectButton）。
 */

import { isRevealOpen, setRevealOpen } from "./reveal.js";

/** 确认卡内容快照（code-review #22）：上传失败分支用它恢复被收起的卡片。 */
export interface ConfirmCardSnapshot {
  sourceKey: "sourceCollect" | "sourceImport" | "sourceUpload";
  total: number;
  newCount: number;
  meta?: string;
  /** 已过滤 N 个（issue #43）：提取通道有值，CSV 导入缺省。 */
  filteredCount?: number;
}

/** DOM 网关注入（jsdom 或 stub 可换——可测 seam，同 popup 的 querySelector 可空习惯）。 */
export interface ConfirmCardDom {
  /** confirmSection（reveal 容器）。 */
  section: HTMLElement | null;
  summary: HTMLElement | null;
  filtered: HTMLElement | null;
  meta: HTMLElement | null;
  pushButton: HTMLButtonElement | null;
  /** hide 时的焦点回收目标（collectButton）。 */
  focusReturnTarget: HTMLElement | null;
}

/** 文案注入（popup 的 i18n 适配层）。 */
export interface ConfirmCardTexts {
  source(key: ConfirmCardSnapshot["sourceKey"]): string;
  summary(source: string, total: number, newCount: number): string;
  filtered(count: number): string;
}

/** 渲染/收起后的 popup 级联动回调（状态行互斥、空提示）。 */
export interface ConfirmCardHooks {
  onRendered(): void;
  onHidden(): void;
}

export interface ConfirmCard {
  /** 渲染确认卡：记快照 → 填充文本 → reveal 开 → pushButton 聚焦解禁。 */
  render(snapshot: ConfirmCardSnapshot): void;
  /** 收起确认卡：焦点回收 → reveal 关（快照保留，失败恢复分支依赖）。 */
  hide(): void;
  /** 上传失败恢复：有快照则重渲并返回 true，无快照 false（不渲染）。 */
  restoreFromSnapshot(): boolean;
  /** 批次已消费（确认成功/取消）：清空快照——后续失败分支不再恢复旧卡（#22）。 */
  consume(): void;
  snapshot(): ConfirmCardSnapshot | null;
  /** 即 lib/reveal.ts 的 isRevealOpen(section)。 */
  isVisible(): boolean;
}

export function createConfirmCard(
  dom: ConfirmCardDom,
  texts: ConfirmCardTexts,
  hooks: ConfirmCardHooks,
): ConfirmCard {
  let lastSnapshot: ConfirmCardSnapshot | null = null;

  /** 渲染路径本体（render 与 restoreFromSnapshot 共用；不含快照记账）。 */
  const paint = (snapshot: ConfirmCardSnapshot): void => {
    if (dom.summary) {
      dom.summary.textContent = texts.summary(
        texts.source(snapshot.sourceKey),
        snapshot.total,
        snapshot.newCount,
      );
    }
    if (dom.filtered) {
      // >0 才渲染：过滤数为 0 时这行是纯噪音。hidden 是唯一可见性开关——
      // 隐藏分支不清文本（残留旧值不可见，行为等价；避免 textContent+hidden
      // 双重表达「不可见」，issue #58-6c）
      const filtered = snapshot.filteredCount ?? 0;
      dom.filtered.hidden = filtered <= 0;
      if (filtered > 0) dom.filtered.textContent = texts.filtered(filtered);
    }
    if (dom.meta) {
      // 同上：hidden 唯一开关，缺省分支不清文本
      dom.meta.hidden = !snapshot.meta;
      if (snapshot.meta) dom.meta.textContent = snapshot.meta;
    }
    setRevealOpen(dom.section, true);
    if (dom.pushButton) {
      dom.pushButton.disabled = false;
      // B 焦点管理：卡片浮现即落到主操作
      dom.pushButton.focus();
    }
    hooks.onRendered();
  };

  return {
    render(snapshot: ConfirmCardSnapshot): void {
      lastSnapshot = snapshot; // #22 失败恢复用快照
      paint(snapshot);
    },

    hide(): void {
      // 焦点回收（B 的对称侧）：卡片持有焦点时收起，reveal-clip 转
      // visibility:hidden 会把焦点坠回 body——先归还给稳定入口；
      // 随后状态行更新由 role="status" 播报。
      if (dom.section?.contains(document.activeElement)) {
        dom.focusReturnTarget?.focus();
      }
      setRevealOpen(dom.section, false);
      hooks.onHidden();
    },

    restoreFromSnapshot(): boolean {
      if (!lastSnapshot) return false;
      paint(lastSnapshot);
      return true;
    },

    consume(): void {
      lastSnapshot = null;
    },

    snapshot(): ConfirmCardSnapshot | null {
      return lastSnapshot;
    },

    isVisible(): boolean {
      return isRevealOpen(dom.section);
    },
  };
}
