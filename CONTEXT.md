# CONTEXT.md — word-radar 领域词汇与模块语言

> 项目级"通用语言"（ubiquitous language）。架构审查、API 边界讨论、ADR 命名都以此为基准。`spec.md` 与 `README.md` 是产品语料；本文档是工程语料。
>
> 任何**新增的工程概念**（端口 / 策略 / 适配器）应在此登记一个名字。领域概念（采集 / 推送 / 词库）已经在 `spec.md` 里稳定，这里只补**接口边界**那一层。

## 领域概念（核心，来自 spec.md / README.md）

- **采集（collect）**：从网页正文里提取英文词条。content script 负责；不写 DB、不发 HTTP。
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
- **`subscribe(handler)`**：`PushCoordinator` 的状态事件订阅。`onProgress` 回调从未被接上 — `subscribe` 替换它，让 popup 从轮询转为事件驱动（C3 的依赖）。

## 模块职责（C1 深化后）

| 模块                   | 职责                                                                    | 不持有             |
| ---------------------- | ----------------------------------------------------------------------- | ------------------ |
| `PushCoordinator`      | 队列 + 状态机 + 单例守卫                                                | 重试策略、节奏策略 |
| `RetryPolicy<TClient>` | 重试间隔 + 错误分类                                                     | 队列、状态         |
| `PushPacing`           | lookup / addWord / word 节奏常量                                        | 重试、队列         |
| `BbdcClient`           | HTTP + 错误类型化（`BbdcAuthError` / `BbdcHttpError` / `BbdcApiError`） | 重试、节奏         |
| `WordRepository`       | IndexedDB 持久化                                                        | HTTP、推送         |

## API 不变量（C1 深化后）

- `PushCoordinator.start()`：并发 1，已运行返回同一 promise。
- `PushCoordinator.getStatus()`：返回 `PushProgress` 快照。
- `PushCoordinator.subscribe(handler)`：handler 在 phase 转换时各回调一次；handler 抛错不影响队列。
- `RetryPolicy<TClient>.withRetry(client, policy)`：不修改 client 类型；保持同名同形状。

## 测试不变量（C1 深化后）

- 每个模块独立测试文件（"接口是测试表面"）。
- `push-coordinator.test.ts` 只测队列与状态。
- `retry-policy.test.ts` 测 `RetryPolicy<TClient>`。
- `push-pacing.test.ts` 测 `PushPacing` 端口契约。
- 现有 `push-coordinator.test.ts` 的 7 个 describe 块会按职责拆分到对应新文件（基本编排 / 状态分类 / 暂停续推 / 单例守卫 / getStatus 留在 push-coordinator；重试策略 / 4xx 分流移到 retry-policy；节奏移到 push-pacing；进度回调改为 subscribe 测试）。

## 实测数据（C1 深化时同步）

- GET `https://langeasy.com.cn/loadLexisList.action?strict=1&word=...` unauth：
  - ramp `1 / 2 / 5 / 10 / 15 / 20 / 30 / 50 / 100 / 150` rps × `30–50` reqs，**共 ~9000 个请求，0 个 429**
  - 平均 `110–130ms`，p95 `120–175ms`（rps=1 冷启 p95 3.4s，之后稳定）
  - 相对 spec 的 2.5 rps 有 **60 倍富余**
- POST `https://bbdc.cn/api/user-new-word` 外部不可测：
  - 三种 body 变体（URL-encoded / multipart+XHR / multipart 无 Referer）一律 `result_code=20000` / `data_kind=exception_handler` / `info=未知错误`
  - delta=0（不入库，无残留）— BBDC 对非浏览器客户端拒绝
  - 实际限频必须从真浏览器测量；深化后默认 `400ms` 保留为防御值

## 不在范围内（避免重新提案）

- 多端自动同步（WebDAV / Gist / 后端）：第一版仅手动 CSV 导入导出。
- 其他背单词 APP（有道 / 百词斩 / 墨墨）：第一版只做不背单词；flags 位已预留。
- YouTube 字幕 / GitHub markdown 专项采集：第一版只做网页正文。
- 推送历史 / 失败原因审计 / 可恢复任务队列：第一版不做。
- 把不背单词 cookie 读出 / 转发 / 上传：永不做（安全边界）。
