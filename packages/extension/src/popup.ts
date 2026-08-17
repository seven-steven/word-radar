import { CORE_VERSION } from "@word-radar/core";

const target = document.querySelector<HTMLElement>('[data-testid="version"]');
if (target) {
  target.textContent = `core ${CORE_VERSION}`;
}

export {};