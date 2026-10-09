/**
 * reveal 开合单一出口（issue #54 code-review 判断题清理）：
 * `.open` class 语义（confirm 卡片与工具抽屉共用的 grid-template-rows
 * 过渡容器，见 popup.css `.reveal.open`）只在此处拼写一次。纯 classList
 * 操作 + null 防御，无 aria/焦点副作用；aria-expanded 是 tools-toggle
 * 按钮的调用点职责，留在 popup.ts。
 */

/** 容器是否展开（.open class 在场）。 */
export function isRevealOpen(el: HTMLElement | null): boolean {
  return el?.classList.contains("open") ?? false;
}

/** 开/收 reveal 容器（force 语义同 classList.toggle）。 */
export function setRevealOpen(el: HTMLElement | null, open: boolean): void {
  el?.classList.toggle("open", open);
}
