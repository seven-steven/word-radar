---
name: e2e
description: Run the extension e2e harness (build + load extension into Chromium + Playwright specs) and read its results. Use after changing extension code (popup / background / content script / push pipeline) to verify in a real browser.
---

# E2E 自验证基座

改完 `packages/extension` 代码后跑这个，替代"改完只能手点浏览器"的盲区。

## 怎么跑

```bash
pnpm e2e                  # 全量：build 全部包 → 起 Chromium 加载扩展 → 跑全部场景
pnpm e2e --no-build       # 跳过 build（确认刚 build 过才用）
pnpm e2e -- --grep push   # 只跑 push 层（smoke / popup / collect / push）
```

首次使用（每台机器一次）：

```bash
pnpm install
pnpm --filter @word-radar/extension exec playwright install chromium
```

## 怎么读结果（优先级顺序）

1. **`dist/e2e-artifacts/<runId>/result.json`** — 先读这个。机器可读：每场景 pass/fail、错误信息、耗时。控制台末行也打印该路径。
2. 失败场景 → `dist/e2e-artifacts/<runId>/raw/` — Playwright outputDir：
   - `*-trace.zip`（`pnpm --filter @word-radar/extension exec playwright show-trace <file>` 离线看每步 DOM 快照/网络/console）
   - 失败截图、`sw-console` 附件（service worker console 全量，含被杀前的日志）
3. `stdout.log` — 全量输出兜底。

保留最近 5 个 run，旧的自动清理。

## 覆盖范围

| 层         | spec              | 内容                                                                   |
| ---------- | ----------------- | ---------------------------------------------------------------------- |
| L1 smoke   | `smoke.spec.ts`   | 扩展加载、SW 注册、无启动错误                                          |
| L2 popup   | `popup.spec.ts`   | popup.html 四视图渲染 + 按钮消息回路（补 popup.ts 胶水层盲区）         |
| L3 collect | `collect.spec.ts` | fixture 页 → content script 采集 → 真实 IndexedDB → counts 刷新        |
| L4 push    | `push.spec.ts`    | retry-push → bbdc/langeasy 全 mock → PushCoordinator 状态机 + 请求形状 |

**安全边界**：bbdc.cn / langeasy 全部被 `context.route` mock，永不触真实外网、永不读 cookie。真实登录路径不自动化。

## 加新场景

在 `packages/extension/test/e2e/` 加 `.spec.ts`，从 `./fixtures.js` import `test`/`expect`。可用 fixtures：`context` / `extensionId` / `popupUrl` / `swConsole` / `mockBbdc` / `fixtureServer`。fixture 页放 `test/e2e/pages/`。vitest（`pnpm test`）只收 `.test.ts`，不会误跑 e2e。

## 已知限制 / 注意

- **workers=1**：单一持久 context 共享扩展状态，并行会互相污染——不要改成 parallel。
- **必须 `channel: 'chromium'`**（fixtures 已内置）：Playwright 默认 headless-shell 不支持 `--load-extension`。`context.route` 拦截 SW 发起的 fetch（含 POST FormData）实测可用。
- **popup 标签页必须 `bringToFront()`** 才能采集目标页（popup 自身是活动标签时显示「content script 未注入」）；push 观察期间也必须前台——后台标签 setTimeout 节流会冻结 500ms 轮询。
- **autoPush 默认开**：push 层测试先点掉 auto-push 复选框，避免自动推送与手动 retry-push 竞态。
- **疑似产品 bug（e2e 基座发现，待修）**：① 采集成功但词库 total=0（WORDS_COLLECTED 写入间歇丢失）；② 空队列 retry-push 永久卡 `running 0/0`。修复前 push/collect 层 3 个用例红。
- 真实 Chrome 验证：`pnpm e2e -- --channel=chrome`。
- 有头观察模式：环境变量 `E2E_HEADED=1`。
- CI 接入时：用 Playwright 官方 docker 镜像或装 xvfb 依赖；new headless 已支持扩展加载，无需 headed。
