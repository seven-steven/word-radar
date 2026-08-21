# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [0.1.0] - 2026-08-22

### 核心功能

- 网页英文生词采集：content script 从网页正文提取英文词条，支持选区优先、正文→main→body→`<pre>` 纯文本回退（覆盖 raw.githubusercontent.com 等直链页）
- 本地词库入库：IndexedDB 持久化存储，`WordRepository` 管理 lemma 主键与 flags 位掩码
- 推送到不背单词生词本：`PushCoordinator` 串行逐词写入 `bbdc.cn` 生词本，cookie 鉴权（扩展不读 cookie 值）
- 词形还原：`@word-radar/core` 的 compromise + 不规则动词表 + 保守后缀 fallback
- CSV 互通：CLI 与扩展通过 CSV 文件交换数据，flags 按位或
- CLI 工具：`extract` 命令（文件/目录递归清洗为 CSV 词表）、`merge` 命令（多词表合并去重）

### 架构深化

#### C1 推送管线深化

- `PushCoordinator`：队列 + 状态机 + 单例守卫 + 状态事件广播
- `RetryPolicy<TClient>`：重试间隔 `[0, 800, 2000]ms`，4xx 与 `BbdcAuthError` 不重试，其余重试 3 次
- `PushPacing`：节奏策略端口（`lookupGapMs: 100`, `addWordGapMs: 400`, `wordGapMs: 400`）
- `subscribe(handler)` 替换 `onProgress`：每次状态变化时回调，支持 popup 事件驱动

#### C2 消息总线深化

- `createMessageBus(deps)` 工厂：闭包绑 5 个 deps，返回 `{ parse, dispatch, parseResponse, onPushStatus }` 4 方法
- `parseExtensionMessage(raw)`：OR 13 个 guard，未知输入返回 `null`
- `dispatch(message)`：switch on `message.type`，调 4 个 internal handler，永不 throw 外泄
- `parseResponse(raw, type)`：出站响应窄化，`type` 显式参数
- `background-listener.ts` 从 227 行缩成 ~10 行 transport wiring

#### C3 popup 净化

- `popup-views.ts`：4 个 render 纯函数（`renderCounts` / `renderLogin` / `renderPushStatus` / `renderSyncStatus`），零 chrome API 依赖
- `createSwChannel(bus)` 工厂：返回 6 方法，每方法 1 行 `chromeSwChannel.X().then(raw => bus.parseResponse(raw, 'X'))`
- `bus.onPushStatus(handler)`：委派 `pushCoordinator.subscribe(handler)`，替换 popup 13 行 `setTimeout` 递归轮询
- `csvExportFileName(now)`：从 popup.ts 迁 `lib/csv-file.ts`，纯函数
- `popup.ts` 271 → ~150 行（减 121 行）

#### C4 错误信任

- `errorMessage(err: unknown): string`：提为 `lib/error-message.ts` 共享 helper，替换 7 处内联重复
- `auth-expired` badge state：`handleCheckLogin` catch 内部用 `instanceof BbdcAuthError` 分支，`BbdcAuthError` → badge `"auth-expired"`，其他错误 → badge `"!"`
- `PushStatus` 合并：旧 `PushProgress` 与 `PushPhase` 删除，7 处引用改 import `PushStatus`
- 删 `isFourHundredError`：4xx 不重试判定改为 `error instanceof BbdcHttpError && error.status < 500`
- 删 `BackgroundBbdcClient` / `BackgroundRepository`：背景侧 dep 形状冗余

#### C5 测试夹具整合

- `test/fakes.ts` 单文件 ~230 行：deps / data / csv 三区域，所有 extension 测试从此 import
- `CsvParseError`：typed error，`kind` 是 7 类字面量 union（`'too-few-columns'` / `'too-many-columns'` / `'nonnumeric-flags'` / `'negative-flags'` / `'fractional-flags'` / `'empty-lemma'` / `'invalid-flags'`）
- `ImportCsvErrorResponse`：`{ok:false, fileName, line, kind, error}`，顶层加 fileName / line / kind 字段
- 9 处 `toMatchObject` 断言替换 regex / 字符串断言

#### C6 采集→入库竞态修复

- 根因：`WORDS_COLLECTED` 从 fire-and-forget 改为应答 ack，`COLLECT_WORDS` 应答等待 SW 入库完成
- 修复：`broadcast` / `runCollection` / `createContentListener` 全链 async 化，持有消息通道（`return true`），`sendResponse` 延迟到 SW 入库完成之后
- `handleWordsCollected` 返回 `Counts` 并作为 ack 通过 `sendResponse(counts)` 回传
- `RunCollectionDeps.broadcast` 签名 `void → Promise<unknown>`，`createContentListener` 返回 `boolean`

### 修复

- 长词表推送中途静默停滞：MV3 service worker 在纯 fetch 循环中不重置 30s idle 计时器会被浏览器杀掉；推送循环现穿插扩展 API 心跳（`chrome.runtime.getPlatformInfo`，间隔 20s）保活
- 图标从 word-radar.svg 重新光栅化，提升各尺寸清晰度
- bbdc addWord 恒 20000：`newwordlist` 必须是 `JSON.stringify(对象)`，数组包对象一律 20000 / `data_kind=exception_handler` / "未知错误"；逆向官方查词插件 v1.2.1（Chrome Web Store ID `cklfipcjofdnmdolnfngpmokdaejidim`）确认对象格式
- raw.githubusercontent.com 采集失败：真因是旧标签未补注入（非 CSP 阻断），`TabsGateway.injectIntoTab(tabId)` 用 `chrome.scripting.executeScript` 从 manifest `content_scripts[].js` 读路径补注入并重试；manifest 扩权 `activeTab` + `scripting`
- 推送状态轮询自启与结束后计数刷新
- 采集→入库竞态导致 total/pending 恒 0
- 4xx 重试漏判、自动推送开关、CSS 与重复清理

### 测试与工程

- e2e 基座：Playwright MV3 persistent context，`pnpm e2e`，result.json / artifact 体系，11/11 全绿
- 测试夹具整合：`test/fakes.ts` 单文件，6 处 core CSV 解析测试改 `.toMatchObject({line, kind})`，3 处 extension CSV 错误响应改 `.toMatchObject({fileName, line, kind})`
- `errorMessage` 5 个 case 测试
- `popup-views` 4 个 render 函数测试
- `csvExportFileName` 边缘 case 测试（9 点 / 跨日 / 跨月 / 闰秒）

### 文档

- `CONTEXT.md`：项目词汇表，登记 C1–C6 引入的工程词
- 采集场景、权限口径与手工验收清单同步

[0.1.0]: https://github.com/seven-steven/word-radar/releases/tag/v0.1.0
