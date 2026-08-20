# CONTEXT.md — word-radar 领域词汇与模块语言

> 项目级"通用语言"（ubiquitous language）。架构审查、API 边界讨论、ADR 命名都以此为基准。`spec.md` 与 `README.md` 是产品语料；本文档是工程语料。
>
> 任何**新增的工程概念**（端口 / 策略 / 适配器）应在此登记一个名字。领域概念（采集 / 推送 / 词库）已经在 `spec.md` 里稳定，这里只补**接口边界**那一层。

## 领域概念（核心，来自 spec.md / README.md）

- **采集（collect）**：从网页正文里提取英文词条。content script 负责；不写 DB、不发 HTTP。页面有选区时优先采选区（`selection`），否则按正文→main→body→`<pre>` 纯文本回退（覆盖 raw.githubusercontent.com 等直链页）。旧标签未注入时由 popup 侧 `TabsGateway.injectIntoTab` 补注入（见下）。
- **词形还原（lemmatization）**：把 running / runs / ran 折回 run。`@word-radar/core` 的 `lemma.ts` + compromise + 不规则动词表。
- **推送（push）**：把词库里的待推词逐个写入「不背单词」生词本。
- **词库（vocabulary / repository）**：扩展 IndexedDB 存储。`WordRepository`，lemma 主键，flags 位掩码。
- **推送协调器（PushCoordinator）**：唯一并发 1、串行推进的推送循环持有者。
- **不背单词生词本**：BBDC 的 `/api/user-new-word`，cookie 鉴权。
- **CSV 互通**：CLI 与扩展通过 CSV 文件交换数据。flags 按位或，已推词不洗回待推。
- **cookie 复用**：扩展不发登录态；靠浏览器对 `bbdc.cn` HttpOnly cookie 原生附带。**安全边界**：扩展代码不读 cookie 值。

## 模块词汇（C1 深化引入）

> 这些不是产品概念，是**接口边界**。架构审查和 ADR 引用它们作为"接缝的名字"。

- **`PushPacing`**：节奏策略端口。结构化对象 `{ lookupGapMs: number; addWordGapMs: number; wordGapMs: number }`。默认 `{ 100, 400, 400 }` — `lookupDefinition` 由 GET 路径 150 rps 实测取 60 倍富余；`addWord` 沿用 spec 防御默认（外部不可实测）。
- **`RetryPolicy<TClient>`**：重试策略端口。泛型包装 `withRetry(client, policy)` 返回同名同形状但带重试的 client。重试间隔 `[0, 800, 2000]ms`，4xx 与 `BbdcAuthError` 不重试，其余重试 3 次。接有道 / 墨墨只换 client。
- **`Retryable<BbdcClient>`**：`BbdcClient` 应用 `RetryPolicy<BbdcClient>` 后得到的实例。`PushCoordinator` 调它，不感知重试。
- **`subscribe(handler)`**：`PushCoordinator` 的状态事件订阅。`onProgress` 回调从未被接上 — `subscribe` 替换它，让 popup 从轮询转为事件驱动（C3 的依赖）。**触发语义**：每次状态变化时回调一次（idle→running / running 中每词推送后 / running→idle），不只是 phase 转换边界 — 这样 popup 能看到 per-word 进度，彻底替代 500ms 轮询。

## 模块词汇（C2 深化引入）

> C1 是「业务模块深模块化」（PushCoordinator / RetryPolicy / PushPacing）。C2 是「基础设施深模块化」 — 跨上下文消息的解析与分发收成一个接缝。

- **`MessageBus`**：跨上下文消息的解析 + 分发 + 响应窄化深模块。`createMessageBus(deps)` 工厂返回 `{ parse, dispatch, parseResponse, onPushStatus }`（**4 方法**，C3 加 `onPushStatus`），闭包绑 5 个 deps（`repository` / `bbdcClient` / `pushCoordinator` / `actionBadge` / `settingsStorage`）。`background-listener.ts` 从 227 行缩成 ~10 行 transport wiring。
- **`parseExtensionMessage(raw: unknown)`**：入站窄化入口。OR 13 个 `isXxx` guard（来自 `messages.ts`），返回 `ExtensionMessage | null`。`null` 让 listener 早返回 `false`（chrome 关 channel）。
- **`dispatch(message: ExtensionMessage): Promise<unknown>`**：入站分发。switch on `message.type`，调 4 个 internal handler（`handleWordsCollected` / `handleExportCsv` / `handleImportCsv` / `handleCheckLogin`）。throw 内部 catch 包成 `{ok:false, error: err.message}`；handler 返回值原样透传（线协议不变）。
- **`parseResponse(raw: unknown, type: ResponseType): unknown`**：出站响应窄化。`type` 显式参数（`'checkLogin'` / `'exportCsv'` / `'importCsv'` / `'collect'` / `'counts'` / `'pushStatus'`）；内部 switch 到 `isXxxResponse` / 新加 `isCounts` / 新加 `isPushStatus`。`sw-channel.ts` 的 5 处散落窄化全部收成 `bus.parseResponse(raw, 'checkLogin')` 一行调用（经 `createSwChannel(bus)` 工厂封装）。

## 模块词汇（C3 深化引入）

> C1 是业务模块深模块化，C2 是基础设施深模块化。C3 是 **UI 层净化** — 把 popup.ts 里的"渲染 + 控制器 + 常量 + 轮询"四件事拆开，把零测试的 UI 局部变成可测的纯函数视图 + 事件驱动控制器。

- **`popup-views.ts`**：4 个 render 纯函数（`renderCounts` / `renderLogin` / `renderPushStatus` / `renderSyncStatus`）。接收 `elements` 对象 + `data`，DOM 更新是唯一副作用。零 chrome API 依赖，零状态，零异步 — happy-dom 可单测。`popup.ts` 271 → ~150 行（减 121 行），4 个 render 迁出。
- **`createSwChannel(bus)` 工厂**：`sw-channel.ts` 改造点。返回 6 个方法（`fetchCounts` / `fetchLoginStatus` / `fetchPushStatus` / `fetchExportCsv` / `importCsv` / `retryPush`），每方法 1 行 `chromeSwChannel.X().then(raw => bus.parseResponse(raw, 'X'))`。原 5 处 inline narrowers 全部消失（依赖 C2 的 `parseResponse`）。popup 调用点零变化（`swChannel.fetchCounts()` 仍是原签名）。
- **`bus.onPushStatus(handler)`**：C3 新加的 MessageBus 第 4 方法，委派 `pushCoordinator.subscribe(handler)`。popup 通过 `bus.onPushStatus((status) => renderPushStatus(els, status))` 替换 13 行 `setTimeout` 递归轮询；handler 拿新 `PushStatus` 直接调 render。
- **`csvExportFileName(now: Date = new Date())`**：从 popup.ts 迁 `lib/csv-file.ts`。纯函数，输入 `Date` 输出 `word-radar-YYYYMMDD-HHmm.csv`（local timezone）。`csv-file.ts` 已有（CSV 解析与生成），自然归位。
- **`BBDC_HOME_URL`**：从 popup.ts 迁 `lib/bbdc-client.ts` 的 `BBDC_ORIGIN` 旁。`bbdc-client.ts` 已有 `BBDC_ORIGIN = "https://bbdc.cn"` 常量；`BBDC_HOME_URL` 是同源不同义（首页路径 vs API origin），并存。

## 模块词汇（C4 深化引入）

> C1 / C2 / C3 是「业务 + 基础设施 + UI」三层深模块化。C4 是 **错误信任** — 把已经类型化（`BbdcAuthError` / `BbdcHttpError` / `BbdcApiError`）的错误信号从运行时 re-sniff 转为类型断言；把窄接口 / 双名重复 / helper 内联全部清理。

- **`errorMessage(err: unknown): string`**：C4 提为 `lib/error-message.ts` 共享 helper。`err instanceof Error` → `err.message`；否则 `String(err)`。替换 7 处内联重复（background-listener / content-listener / push-coordinator / bbdc-client / cli/src/extract / cli/src/merge × 2 / cli/src/index）。cli 跨包不重定向（cli 保留内联或后续走 `@word-radar/core`）。
- **`auth-expired` badge state**：C4 新加的 ActionBadge 取值。`handleCheckLogin` catch 内部用 `instanceof BbdcAuthError` 分支 — `BbdcAuthError` → badge `"auth-expired"`（session 过期明确提示）；其他错误 → badge `"!"`（网络 / 未知）。不再 bare `catch {}` 一律 `"!"`。
- **`Pick<BbdcClient, ...>`**：`PushCoordinatorOptions.client` 的 port 声明（C1 设计）。C4 保留 — 这是深模块的合理窄接口（producer 只声明它真正用的方法），与已删除的 `BackgroundBbdcClient`（背景侧 dep 形状冗余）不同。`BackgroundBbdcClient` / `BackgroundRepository` 在 C4 删除。
- **`PushStatus`（合并后唯一名）**：`messages.ts:35` 定义；`push-coordinator.ts:13–23` 旧 `PushProgress` 与 `PushPhase` 在 C4 删除，7 处 push-coordinator 引用改 import `PushStatus`。wire / internal 共用一名。

- **`CollectOptions.excludedTags` + pre 回退**：`collect.ts` 的排除标签集合改为可注入(`excludedTags`);`collectPageText` 在 body 正常路径采集为空时,回退用去掉 `PRE` 的排除集重采 — 覆盖正文整体在 `<pre>` 的纯文本页(raw.githubusercontent.com / pastebin)。普通网页正文非空不走回退,代码块照旧排除;可见性检查在回退中仍生效。
- **`TabsGateway.injectIntoTab(tabId)`**：`active-tab.ts` 2026-08-19 新增端口，2026-08-20（issue #14）转正为**采集主路径**。manifest 已移除 declarative content_scripts（activeTab 瘦身），`requestCollection` 每次「先 `chrome.scripting.executeScript` 注入再 `sendMessage`」；内容脚本由 vite 插件 `buildContentScript` 用 esbuild 独立打包为**单文件 IIFE**，落到稳定路径 `assets/content-script.js`（`CONTENT_SCRIPT_FILES` 常量指向它；不用 crxjs 的 content_scripts seam —— 其 loader 动态 import 哈希 bundle，listener 注册异步落在 executeScript resolve 之后，紧随的 sendMessage 竞态性失败，e2e 实测复现）。`content.ts` 有幂等守卫（isolated world 全局标志）防重复 listener。注入或消息失败（`chrome://` 等不可注入页）归一错误文案「此页面无法采集：chrome:// 等特殊页不支持注入」。e2e harness 无法产生真实用户手势（popup 以标签页模拟，activeTab 不授权），fixtures 以临时副本 + 测试期 host_permissions 替代授权。相关教训：raw.githubusercontent.com 的 CSP `sandbox` 头**不**阻断 content script（早先相反结论是 e2e 标签顺序假阳性）。

## 模块词汇（C5 深化引入）

> C1–C4 是「业务 + 基础设施 + UI + 错误」四层深模块化。C5 是 **测试夹具整合** — 把跨文件 inline 重复的 fake / data / CSV fixture 收成单文件 `test/fakes.ts`；把 core CSV 错误类型化为 `CsvParseError`，让 9 处 toMatchObject 断言替换 regex / 字符串断言。

- **`test/fakes.ts`**：`packages/extension/test/fakes.ts` 单文件，~230 行；分 deps / data / csv 三区域：
  - deps：`fakePushCoordinator` / `fakeSettingsStorage` / `fakeRepository` / `fakeBbdcClient` / `resetDatabase`（5 处 dedup，原跨 5 文件）
  - data：`FakeEntry` / `makeEntry(lemma)` / `WordEntry` helpers（push-coordinator 等共享）
  - csv：`CSV_HEADER` / `CSV_BASIC_RUN` / `CSV_INVALID_LINE_THREE` 等常量（原 10+ 处内联重复）
- **`CsvParseError({line, column?, kind, message})`**：`packages/core/src/csv.ts` 的 typed error。`kind` 是 7 类字面量 union：`'too-few-columns'` / `'too-many-columns'` / `'nonnumeric-flags'` / `'negative-flags'` / `'fractional-flags'` / `'empty-lemma'` / `'invalid-flags'`。与 C4 `BbdcAuthError` / `BbdcHttpError` / `BbdcApiError` 同型模式 — typed error 替 string。
- **`ImportCsvErrorResponse({ok:false, fileName, line, kind, error})`**：`handleImportCsv` catch `CsvParseError` 后响应 shape。顶层加 `fileName` / `line` / `kind` 字段（从 CsvParseError 透传）；与 C2 dispatch 错误的 `{ok:false, error}` 兼容（`error` 仍带 fileName 前缀字符串）。popup / 测试可读结构化字段。

## 模块词汇（C6 采集→入库竞态修复）

> C1–C5 是深模块化分层。C6 是**竞态修复**：修「采集数 N 但 total/pending 恒 0」的间歇性 bug。

- **根因**：content script 的 `WORDS_COLLECTED` 是 fire-and-forget 广播，`COLLECT_WORDS` 应答（词数 N）不等待 SW `mergeCollected` 完成。popup 收到应答立刻 `refreshCounts()`，若 IndexedDB readonly 事务在 readwrite 提交之前读到旧快照 → counts=0，之后再不刷新。间歇性，时序不定。
- **修复**：`broadcast` / `runCollection` / `createContentListener` 全链 async 化，持有消息通道（`return true`），`sendResponse` 延迟到 SW 入库完成之后。popup 拿到的 COLLECT_WORDS 应答意味着词已入库，`refreshCounts()` 自然读到新值。`handleWordsCollected` 返回 `Counts` 并作为 ack 通过 `sendResponse(counts)` 回传。`maybeStartPush` 失败静默（`.catch(() => undefined)`）不影响应答。
- **模块职责不变量升级**：`RunCollectionDeps.broadcast` 签名 `void → Promise<unknown>`（必须 resolve 在 SW 入库完成后）；`createContentListener` 返回 `boolean`（`true` 持有通道）。
- **验证**：`test/e2e/raw-pre.spec.ts` 新场景（pre 正文页 + 无脚本页），`test/run-collection.test.ts` / `test/content-listener.test.ts` / `test/background-listener.test.ts` 全链 async 改写；collect e2e 3 次连续跑全绿（之前间歇性失败）。

## 模块职责（C6 深化后）

| 模块                     | 职责                                                                    | 不持有                                              |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `PushCoordinator`        | 队列 + 状态机 + 单例守卫 + 状态事件广播                                 | 重试策略、节奏策略                                  |
| `RetryPolicy<TClient>`   | 重试间隔 + 错误分类                                                     | 队列、状态                                          |
| `PushPacing`             | lookup / addWord / word 节奏常量                                        | 重试、队列                                          |
| `BbdcClient`             | HTTP + 错误类型化（`BbdcAuthError` / `BbdcHttpError` / `BbdcApiError`） | 重试、节奏；含 `BBDC_ORIGIN` / `BBDC_HOME_URL` 常量 |
| `WordRepository`         | IndexedDB 持久化                                                        | HTTP、推送                                          |
| `MessageBus` (C2/C3)     | 消息解析 + 分发 + 响应窄化 + `onPushStatus` 委派；4 个 internal handler | transport、类型定义、具体业务                       |
| `popup-views` (C3)       | 4 个 render 纯函数（counts / login / push / sync）                      | 状态、异步、chrome API                              |
| `createSwChannel` (C3)   | popup → SW 的 send + parse 包装工厂                                     | 解析（用 bus）、transport（用 chromeSwChannel）     |
| `errorMessage` (C4)      | 跨包 `unknown → string` 工具（`lib/error-message.ts`）                  | 任何领域、任何上下文                                |
| **`test/fakes.ts`** (C5) | extension 测试共享夹具（deps / data / csv 三区域）                      | production code；任何领域逻辑                       |

## API 不变量（C1 深化后）

- `PushCoordinator.start()`：并发 1，已运行返回同一 promise。
- `PushCoordinator.getStatus()`：返回 `PushStatus` 快照（C4 合并后；旧名 `PushProgress` 已删）。
- `PushCoordinator.subscribe(handler)`：**每次状态变化时**各回调一次（idle→running / running 中每词推送后 / running→idle），不只是 phase 转换边界（C3 升级前是"phase 转换时"，被 C3 替换以彻底替代 popup 轮询）；handler 抛错不影响队列。
- `RetryPolicy<TClient>.withRetry(client, policy)`：不修改 client 类型；保持同名同形状。

## API 不变量（C2 深化后）

- `bus.parse(raw)`：未知输入 → `ExtensionMessage | null`。`null` 表示不是任何已知消息类型，listener 早返回 `false` 关 channel。
- `bus.dispatch(message)`：永不 throw 外泄；handler 抛错被内部 catch 包成 `{ok:false, error: err.message}`；handler 返回值原样 resolve（线协议不变）。
- `bus.parseResponse(raw, type)`：`type` 是 `'checkLogin'` / `'exportCsv'` / `'importCsv'` / `'collect'` / `'counts'` / `'pushStatus'` 之一；返回 `unknown`（已窄化但 caller 需自行 cast 或 narrow）。
- `createMessageBus(deps)`：5 个 deps 全闭包；不修改 deps；多次调用产生独立 bus 实例。

## API 不变量（C3 深化后）

- `bus.onPushStatus(handler)`：**C3 新加**第 4 方法，委派 `pushCoordinator.subscribe(handler)`。handler 在每次状态变化时各回调一次；返回 unsubscribe 函数。
- `createSwChannel(bus)`：返回 6 方法，每方法 1 行 `chromeSwChannel.X().then(raw => bus.parseResponse(raw, 'X'))`；`retryPush` 无响应窄化（chromeSwChannel 自带）；不持有 transport 或 parse — 只组合两者。
- `popup-views` 4 个 render 函数：纯函数，签名 `(elements, data) => void`；无返回值、无异步、无 chrome API；DOM 是唯一副作用。
- `popup.ts` 8 个 async wrapper：每个 ~10 行，紧凑于其触发的按钮；调 `swChannel.X()`（依赖 C3 `createSwChannel` 工厂），调 `renderX(els, data)`（依赖 `popup-views`），catch 错误 → render `sync-status` 错误文本。
- `bus.onPushStatus` 与 popup 轮询互斥：落地后 popup.ts 不再有 `setTimeout` 递归；启动时 `bus.onPushStatus((status) => renderPushStatus(els, status))` 一行接好。

## API 不变量（C4 深化后）

- **`errorMessage(err: unknown): string`**：纯函数；不修改入参；返回 `Error.message` 或 `String(err)`。零副作用，零依赖 — 任何上下文可用。
- **`push-coordinator` 信任 `BbdcHttpError` / `BbdcAuthError` 类型**：删 `isFourHundredError`（runtime status sniff）；4xx 不重试的判定改为 `error instanceof BbdcHttpError && error.status < 500`（类型断言）。
- **`push-coordinator.isAuthError` 简化**：删 `name === "BbdcAuthError"` fallback；只用 `error instanceof BbdcAuthError`（源头全是 `new BbdcAuthError(...)`，name fallback 是死分支）。
- **`handleCheckLogin` catch 内部用类型分支**：`BbdcAuthError` → `actionBadge.set('auth-expired')`；其他错误 → `actionBadge.set('!')`。不再 bare `catch {}` 一律 `"!"`。
- **`BbdcClient.parseJson` 保留 `cause`**：`throw new Error(msg, { cause })` 把原始 `response.json()` 失败对象链到新 Error 上；消费者可读 `error.cause`。
- **`BbdcClient.readResultCode` 不返 NaN**：invalid body（缺 `result_code` 或非数字）时 `throw BbdcHttpError('invalid bbdc response: missing result_code', 502)`。callers (`checkLogin` / `addWord`) 仍 `resultCode !== 200`，逻辑不变；NaN 从类型路径上消除。

## API 不变量（C5 深化后）

- **`test/fakes.ts` 单文件原则**：所有 extension 测试共享 fake / data / CSV fixture 在此一处声明；不出现跨文件复制。修改一处，全 test 生效。
- **`CsvParseError` 7 类 `kind` 字面量 union**：`'too-few-columns'` / `'too-many-columns'` / `'nonnumeric-flags'` / `'negative-flags'` / `'fractional-flags'` / `'empty-lemma'` / `'invalid-flags'`。新增错误类型必须扩 union（编译时强制）；不允许 `'other'` / `string` 等开放字符串。
- **`handleImportCsv` catch 分支语义**：`CsvParseError` 实例 → 响应 `{ ok: false, fileName, line, kind, error }`（fileName/line/kind 顶层）；其他 Error → 响应 `{ ok: false, error: errorMessage(err) }`（仅错误字符串）。两条路径互斥，由 `error instanceof CsvParseError` 区分。
- **`toMatchObject` 断言契约**：CSV 错误统一用 `.toMatchObject({fileName, line, kind})` 断言结构化字段；generic 错误保留 `.toEqual({ok:false, error: 'string'})`。两条断言形式不混用。

## 测试不变量（C1 深化后）

- 每个模块独立测试文件（"接口是测试表面"）。
- `push-coordinator.test.ts` 只测队列与状态。
- `retry-policy.test.ts` 测 `RetryPolicy<TClient>`。
- `push-pacing.test.ts` 测 `PushPacing` 端口契约。
- 现有 `push-coordinator.test.ts` 的 7 个 describe 块会按职责拆分到对应新文件（基本编排 / 状态分类 / 暂停续推 / 单例守卫 / getStatus 留在 push-coordinator；重试策略 / 4xx 分流移到 retry-policy；节奏移到 push-pacing；进度回调改为 subscribe 测试）。

## 测试不变量（C2 深化后）

- `messages.test.ts`（206 行）保留不动 — 13 guard 单测的"接口是测试表面"在 guard 层级。
- `message-bus.test.ts`（新）测 `parse` / `dispatch` / `parseResponse` 三方法：parse happy/sad path、dispatch 各 handler happy/sad + 错误包成 `{ok:false, error}`、parseResponse 各 type 的 happy/sad。
- `sw-channel.test.ts`（改）测 `bus.parseResponse(raw, 'checkLogin')` 等调用，mock `SwChannel` 接口。
- `background-listener.test.ts`（621 行）删除 — 内容已迁 `message-bus.test.ts`；listener 缩到 ~10 行后无独立测试价值。
- 4 个 handler 没有独立测试文件 — 它们是 MessageBus 的 internal 细节，外部只能通过 `bus.dispatch(message)` 触达。

## 实测数据（C1 深化时同步）

- GET `https://langeasy.com.cn/loadLexisList.action?strict=1&word=...` unauth：
  - ramp `1 / 2 / 5 / 10 / 15 / 20 / 30 / 50 / 100 / 150` rps × `30–50` reqs，**共 ~9000 个请求，0 个 429**
  - 平均 `110–130ms`，p95 `120–175ms`（rps=1 冷启 p95 3.4s，之后稳定）
  - 相对 spec 的 2.5 rps 有 **60 倍富余**
- POST `https://bbdc.cn/api/user-new-word`（2026-08-19 修正——早前"外部不可测 / BBDC bot 拒绝"的结论是**误判**）：
  - 早前外部 curl 三种 body 变体一律 `result_code=20000`，曾被解读为"BBDC 对非浏览器客户端拒绝"
  - 真正根因：请求体形状错误 — `newwordlist` 必须是 `JSON.stringify(对象)`，数组包对象（实现期走样）一律 20000 / `data_kind=exception_handler` / "未知错误"
  - 权威参照：官方查词插件（Chrome Web Store ID `cklfipcjofdnmdolnfngpmokdaejidim` v1.2.1）— 对象形态、零自定义头、无 host_permissions
  - 2026-08-19 修正后真机验证：逐词加词成功，推送全链路通
  - 限频阈值仍未实测（外部 curl 形状错误时测不出限频）；`400ms` 防御默认保留

## 测试不变量（C3 深化后）

- `popup-views.test.ts`（新）测 4 个 render 函数：每函数给 mock elements（`{ totalEl, pendingEl, ... }` 用 happy-dom `HTMLElement`）+ data，断言 `textContent` / `dataset` / `hidden` 等 DOM 输出。9 点 / 跨日 / 跨月 / 闰秒类边缘 case 走 csvExportFileName（移入 csv-file.ts 后）。
- `message-bus.test.ts`（C3 加）增 `onPushStatus` 委派测试 — 断言 bus.onPushStatus(h) → pushCoordinator.subscribe(h)；handler 抛错不影响委派链。
- `sw-channel.test.ts`（C3 改）mock `createSwChannel(bus)` 工厂，6 方法各测 happy / sad / throw path；`bus.parseResponse` mock 返回各 type 的预期窄化结果。
- `csv-file.test.ts`（C3 加）`csvExportFileName(now)` 边缘 case：9 点 → `HHmm` 正确；跨日 → 日期 +1；跨月 → 月 +1；闰秒 → 用 `Date.now()` 走默认参数（不验证闰秒，因为依赖宿主时钟）。
- `popup.test.ts` **不新增** — popup.ts 仍是"DOM lookup + handlers + boot"胶水层，UI glue 零测试惯例（依赖 chrome 扩展生态）。C5 提测试夹具整合时如果 popup 仍未测，留作"已知未覆盖"。

## 测试不变量（C4 深化后）

- `error-message.test.ts`（新）测 `errorMessage(err)` 5 个 case：`Error` → `.message`；`string` → 原字符串；`{ code: 'ENOENT' }` → `'[object Object]'`；`undefined` → `'undefined'`；`new Error('outer', { cause: new Error('inner') })` → `.message` 是 `'outer'`（不递归 cause，errorMessage 只看表层）。
- `push-coordinator.test.ts`（C4 改）4xx-retry 用例改用 `new BbdcHttpError('...', 404)` / `new BbdcHttpError('...', 429)` 直接构造；isAuthError 走 Pause 用例改用 `new BbdcAuthError('...', { kind: 'http', status: 401 })` 直接构造；删 `isFourHundredError` / `isAuthError` 单独的 describe 块（已删除函数）。
- `bbdc-client.test.ts`（C4 改）加 `parseJson` `{cause}` chaining 测试：mock `response.json()` throw → 抛出的 Error `cause` 字段引用原 throw；加 `readResultCode` throw 测试：缺 `result_code` body → throw `BbdcHttpError('invalid bbdc response: missing result_code', 502)`。
- `message-bus.test.ts`（C4 改，待 C2 落地后）`handleCheckLogin` 测试扩为分支断言：`BbdcAuthError` 实例 → mock badge 收到 `'auth-expired'`；其他 Error → mock badge 收到 `'!'`。
- `messages.test.ts` / `sw-channel.test.ts` / `popup-views.test.ts` / `csv-file.test.ts` 不变。

## 测试不变量（C5 深化后）

- `test/fakes.ts`（新）单文件 ~230 行；所有 extension 测试从此 import，不允许 inline 定义 fake。deps / data / csv 三区域用注释分隔；导出 `fakePushCoordinator` / `fakeSettingsStorage` / `fakeRepository` / `fakeBbdcClient` / `resetDatabase` / `FakeEntry` / `makeEntry` / `CSV_HEADER` / `CSV_BASIC_RUN` / `CSV_INVALID_LINE_THREE` 等。
- 6 处 core CSV 解析测试改 `.toMatchObject({line, kind})`：`packages/core/test/merge-csv.test.ts:158-186`（too-few / too-many / nonnumeric / negative / fractional / empty-lemma）。
- 3 处 extension CSV 错误响应改 `.toMatchObject({fileName, line, kind})`：`background-listener.test.ts:439` / `sw-channel.test.ts:168` / `csv-sync.test.ts:149`。
- generic `{ok:false, error:'string'}` 断言（export-failed / mark-failed / counts-failed 等）保留 `.toEqual`；不强制 toMatchObject（无类型化价值）。
- cli 测试、`active-tab` / `content-listener` / `collect` / `run-collection` / `csv-file` / `smoke` / core 其他测试：fakes 不重复，不动 import。
- vitest.config.ts 不变（per Q5 决策）；per-file `// @vitest-environment jsdom` 注释保留。

## 不在范围内（避免重新提案）

- 多端自动同步（WebDAV / Gist / 后端）：第一版仅手动 CSV 导入导出。
- 其他背单词 APP（有道 / 百词斩 / 墨墨）：第一版只做不背单词；flags 位已预留。
- YouTube 字幕 / GitHub markdown 专项采集：第一版只做网页正文。
- 推送历史 / 失败原因审计 / 可恢复任务队列：第一版不做。
- 把不背单词 cookie 读出 / 转发 / 上传：永不做（安全边界）。
- **`MessageBus` 不管 transport**（`chrome.runtime.onMessage` wiring）— 那是 `background.ts` 的事；MessageBus 只暴露 4 个方法，listener 自己写。
- **`MessageBus` 不动态注册新 type** — 编译时 `ExtensionMessage` union 已定；加 type 必须改 `messages.ts`（C5 提案未走前不要尝试自动发现）。
- **offscreen / external sender 第一版不存在** — 如果未来加，MessageBus 加新分支即可；现在不要为不存在的 sender 预留接口。
- **`popup.ts` 8 个 async wrapper 不提取到 popup-controllers.ts** — 与按钮耦合紧密，提取会增加间接（参）而不增可测性。
- **`popup.ts` 不引入 wireAction 声明式 helper** — boilerplate 减少得不偿失，调试路径更复杂。
- **`bus.onPushStatus` 不暴露通用 subscribe** — 只委派 pushCoordinator.subscribe；其他子系统（settingsStorage 变化等）若有事件订阅需求，再独立添加。
- **`errorMessage` 不放 `@word-radar/core`** — 第一版只在 `lib/error-message.ts`；cli 跨包 import 工作量大于 dedup 收益；后续真要 dedup 走独立 issue。
- **`BbdcAuthError.kind` discriminator 不展开使用** — `kind: 'http' | 'check-login'` 字段已存在但当前无 consumer 分支；C4 不主动加新分支（避免越界到下游 UX 决策）。
- **`isPushStatus` runtime phase-list 不删** — 是 wire boundary narrowing 的合法用法（防 `unknown` 输入），不是 trust gap。
- **`test/fakes.ts` 不拆为多文件** — 230 行单文件可管理；拆目录增加 import 路径长度，收益有限。
- **`test/fakes.ts` 不放 workspace root (`packages/test/`)** — cli / core 测试不需要 fake（只测真代码），多余抽象层。
- **`CsvParseError.fileName` 不在 core 源头** — core 解析器无文件信息；fileName 在 `handleImportCsv` 响应顶层字段加，避免 core API 加可选参数污染。
- **vitest.config.ts 不加 setupFiles** — fake-indexeddb/auto 在 word-repository.test.ts:6 / csv-sync.test.ts:9 各 import 一行即可；setupFiles 增加间接不抵收益。
- **`test/fakes.ts` 不为 cli / core 共享** — cli / core 测试不重复 fake；workspace 跨包 fake 抽象是过度设计。
