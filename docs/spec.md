# Spec: 单词雷达 WordRadar

> 由 `to-spec` 流程综合 4 轮领域建模(grilling)+ 不背单词 API 抓包实测(2026-08-03)+ 数据模型最终化产出。
> Triage: ready-for-agent

## Problem Statement

英语学习者在阅读英文网页、文章、wiki 时,会遇到大量生词。手动把这些生词一个个录入背单词 APP 的生词本,既繁琐又容易遗漏;而读完一篇文章后,生词散落在各处,很难系统地收集起来进入复习流程。用户希望:在读到一个网页时,能**一键把整个网页(或选中的一段)里的英文生词批量提取出来,自动添加到「不背单词」APP 的「我的生词本」**,这样就能在不背单词里统一背诵复习。同时,对于本地已有的文本/字幕文件,希望能用命令行工具批量清洗成词表。

## Solution

一款 **CLI + 浏览器扩展双形态**的单词拾取工具,共享一个 TypeScript 核心:

- **浏览器扩展(主形态)**:在任意网页上,提取正文(或用户选区)里的英文单词,经词形还原(lemma)去重后,即时批量推送到不背单词「我的生词本」。扩展直接复用用户在不背单词网页的登录凭证(HttpOnly cookie),无需额外登录或 token。
- **CLI(辅形态)**:把本地 `.txt`/`.md` 文件清洗成词表(CSV),或在多份词表之间合并去重。CLI 不直接调用不背单词接口(它拿不到浏览器 cookie),而是通过 CSV 文件与扩展交换数据。
- **极简词库**:每条记录就是 `lemma,flags`(flags 是位掩码,标记各背单词 APP 的推送状态),用 CSV 格式存储以最小化体积。

第一版只对接「不背单词」一个 APP,但数据模型的位掩码设计为后续接入有道、百词斩、墨墨预留了位置。第一版零后端,扩展与 CLI 之间靠手动 CSV 导入导出同步。

## User Stories

1. 作为英语学习者,我想在阅读英文网页时一键提取全文生词,以便不用手动逐个查词录入。
2. 作为英语学习者,我想只提取网页正文(排除导航/广告/代码),以便得到的词都是有学习价值的真实词汇。
3. 作为英语学习者,我想选中网页上的一段文字后只提取这段的生词,以便针对特定段落精准收集。
4. 作为英语学习者,我想提取出的词自动按词形还原去重(running/runs/ran 算作 run),以便同一词的不同变形不会重复出现。
5. 作为不背单词用户,我想提取出的词自动添加到我的不背单词生词本,以便直接在不背单词 APP 里背诵。
6. 作为不背单词用户,我想扩展自动复用我已登录的不背单词网页凭证,以便不用在扩展里再次登录或配置 token。
7. 作为不背单词用户,我想在扩展检测到我未登录不背单词时被提示并引导去登录,以便推送不中断。
8. 作为不背单词用户,我想已经在我生词本里的词不会被重复添加,以便保持生词本干净。
9. 作为不背单词用户,我想推送失败的词保留为待推状态、之后能重试,以便网络抖动不会丢词。
10. 作为用户,我想在扩展弹窗里看到本次采集了多少词、多少待推、推送进度(成功/已存在/失败),以便了解状态。
11. 作为用户,我想在扩展弹窗里手动触发「重新推送待推词」,以便登录后或网络恢复后继续。
12. 作为用户,我想把扩展里的词库导出成 CSV 文件,以便备份或交给 CLI 处理。
13. 作为用户,我想把 CSV 文件导入扩展的词库,以便把 CLI 清洗出的词纳入推送流程。
14. 作为用户,我想导入时已有的推送状态不丢失(同词合并、flags 取或),以便重复导入不会把已推词变回待推。
15. 作为命令行用户,我想用 `word-radar extract <文件>` 把本地英文文本变成 CSV 词表,以便批量处理存量材料。
16. 作为命令行用户,我想用 `word-radar extract <目录>` 递归处理一个目录下的多个文件,以便一次清洗一批。
17. 作为命令行用户,我想用 `word-radar merge <a.csv> <b.csv>` 合并多份词表并去重,以便汇总不同来源的词。
18. 作为多设备用户,我想词库能在不同设备间同步(第一版靠手动 CSV 导入导出,后续可配 WebDAV/Gist),以便在多台机器上使用。
19. 作为注重隐私的用户,我想扩展不读取或上传我的不背单词 cookie,完全只在本地浏览器内使用,以便我的登录凭证不外泄。
20. 作为注重隐私的用户,我想扩展只申请最小必要权限(不申请 cookies/activeTab/notifications),以便减少权限顾虑。
21. 作为扩展用户,我想工具在 Chrome 和 Edge 上都能用,以便在不同浏览器上使用。
22. 作为未来用户,我想后续能扩展到有道、墨墨等其他背单词 APP,以便选择自己喜欢的 APP(第一版不做,但架构预留)。
23. 作为未来用户,我想后续能采集 YouTube 字幕、GitHub markdown(第一版不做),以便覆盖更多来源。
24. 作为开发者,我想 core 提取逻辑在扩展和 CLI 之间共享同一份实现,以便避免重复代码和行为不一致。
25. 作为开发者,我想核心数据模型简单到一条记录就是 `lemma,flags`,以便词库文件最小化、同步成本最低。

## Implementation Decisions

### 形态与架构

- 双形态:Chrome/Edge MV3 扩展(主)+ Node CLI(辅),共享 `@word-radar/core` 包。
- pnpm workspace monorepo:`packages/{core,extension,cli}`。
- 包边界:**core 是纯 TypeScript**(无 DOM/浏览器/Node API),只做「文本→词」「合并」「CSV 编解码」。扩展的网页正文提取放 content script;IndexedDB 放扩展存储层;HTTP 调用放 service worker。CLI 只做文件 IO + 调 core。
- 消费方式:extension 和 CLI 都通过 core 的 package `exports` 消费构建产物(dist),禁止跨包 import `src`。

### 数据模型(核心决策)

每条词记录就是两个字段,CSV 序列化:

```
lemma,flags
serendipity,0
run,1
```

- `lemma`:词形还原后的基本形(如 running/runs/ran → `run`),是主键。
- `flags`:十进制位掩码。bit0(1)=不背单词已成功推送;bit1(2)=有道(预留);bit2(4)=百词斩(预留);bit3(8)=墨墨(预留)。0=全部待推。
- 只记录成功两态(位=1=成功);失败不置位,保持待推可重试。
- **不保留原词形**(无 surfaceForms 字段),以最小化文件体积。
- 内存对象仍是结构化 `{lemma, flags}`;只有导入导出和 CLI 输出用 CSV。

### 提取管线(core)

- Unicode NFKC 规范化(弯引号→`'`、Unicode 连字符→`-`)。
- 分词:识别英文词(含内部 `'`/`-`,如 don't、well-known);同时保留 URL/email/路径/代码标识符候选,交给 filter 拒绝(避免把 https/example/com 当词)。
- 过滤:排除 URL、email、路径、纯数字、`snake_case`、`camelCase`、`PascalCase`、含 `$`、含数字的标识符;用 compromise 的 `#ProperNoun` 默认排除专名(可开关)。
- 词形还原:用 **compromise**(`verbs().toInfinitive()` / `nouns().toSingular()`),配不规则动词表 + 保守后缀 fallback。
- 去重:按 lemma 聚合(小写),合并后只保留 lemma 一行。
- 公开 API:`extractWordEntries(text, options) → {lemma, flags:0}[]`、`mergeWordEntries(...)`(lemma 合并、flags 按位 OR)、CSV `parse`/`stringify`。

### 不背单词对接(API 全部实测通过)

鉴权 = 纯 HttpOnly cookie,无 token/CSRF。扩展只需 `host_permissions` + service worker 以 `credentials:"include"` 发请求。

- 登录检查:`GET https://bbdc.cn/api/check-login`(result_code 200 = 已登录)。
- 查词释义:`GET https://langeasy.com.cn/loadLexisList.action?strict=1&word=<w>`(取 wordlist[0].interpret)。
- 查重:`GET https://bbdc.cn/api/check-new-word?word=<w>&infoidx=100`(data_body.list 非空 = 已存在)。
- 加词:`POST https://bbdc.cn/api/user-new-word`,FormData 字段 `newwordlist` = JSON `{word, info(释义), course:"*", wordidx:"*", infoidx:"100", selection:"*", opcode:"1"}`。不手动设 Content-Type(让浏览器带 multipart boundary)。result_code 200 = 成功。
- 生词列表:`GET https://bbdc.cn/api/user-new-word?page=<N>`(分页)。
- 删词:`POST https://bbdc.cn/api/remove-user-new-word`(newwordlist=逗号分隔词串)。
- 这些接口(尤其逐词加生词本的 POST)是通过逆向不背单词官方查词插件发现的(网页 UI 只暴露批量建词书,不暴露逐词加);已在用户账号真实加/删词验证。

### 扩展行为

- Content script:提取优先级 = 非空选区 → `<article>` → `<main>` → `<body>` 兜底;TreeWalker 收集可见文本,排除 script/style/nav/header/footer/aside/form/pre/code 等 + hidden/aria-hidden/CSS 隐藏。提取后发 `{type:"WORDS_COLLECTED", entries}` 消息;**不写 DB、不发 HTTP**。
- Service worker:**独占 IndexedDB 写入 + 推送调度 + 所有 HTTP**。收到 WORDS_COLLECTED 先合并入库,再非阻塞触发推送。
- 推送协调器:顺序 = checkLogin → listPending → 逐词串行(checkExists→lookup→addWord);并发 1、词间 ~400ms;单请求最多 3 次重试(0/800ms/2000ms),4xx 不重试;401/403/check-login 失败立即暂停并保留 pending;远端已存在也标记已推;同一时刻只跑一个推送循环。
- 登录引导:action badge + popup 提示,提供「打开不背单词」按钮(打开 `https://bbdc.cn/`,不固化深层 login URL)。第一版不申请 notifications 权限。
- Popup:展示采集数/待推数/推送状态/成功/已存在/失败计数;按钮:检查登录、打开不背单词、重试待推、导入 CSV、导出 CSV。配置(自动推送开关等)存 `chrome.storage.local`;词库存 IndexedDB。

### 技术栈

- pnpm workspace + TypeScript 严格模式 + ESM。
- core:`tsup` 构建到 dist,exports 暴露。
- 扩展:Vite + `@crxjs/vite-plugin`。
- CLI:`commander` + `tsup`(打成带 shebang 的 ESM 单文件)。
- 词形还原:`compromise`(纯 JS,扩展和 Node 共用)。
- 扩展存储:`idb`(IndexedDB 封装)。

### 同步

- 第一版:零后端,扩展↔CLI 靠手动 CSV 导入导出。
- 后续(范围外):WebDAV/Gist/轻后端。架构「尽可能零后端」(非硬约束)为后续留口。

## Testing Decisions

**主接缝 = core 的纯函数**(最高接缝、最稳、最少):

- `extractWordEntries(text)` —— 给文本,验提取出的 lemma 集合:含 `Running ran runs` → lemma `run` 一行;URL/email/代码标识符被排除;专名默认排除。
- `mergeWordEntries(...)` —— 验 lemma 合并、flags 按位 OR(已推状态不丢)。
- CSV `parse`/`stringify` —— 往返一致;坏行报行号而非静默接受;flags 十进制正确编解码。

**辅助接缝 = 扩展内部,注入 mock**(中接缝):

- `BbdcClient`:注入 mock fetch,验各方法的 URL/FormData/result_code 判断、鉴权失败抛 `BbdcAuthError`。
- `PushCoordinator`:注入 mock client + 假 repository,验编排顺序(已存在→标记、成功→标记、失败→保持 pending、未登录→暂停、并发守卫)。
- `WordRepository`:用 IndexedDB(可 fake-indexeddb 或 jsdom)验 mergeCollected/listPending/markPushed。

**端到端 = 手工**(低接缝,需真实登录态,不自动化):

- 真实加载扩展到 Chrome/Edge,登录不背单词,在英文网页拾取,确认词真的写入不背单词生词本(和抓包验证时一致)。

测试理念:只测外部行为,不测实现细节;core 行为用纯函数单测覆盖最广,扩展编排用 mock 覆盖关键路径,真实加词靠手工清单。优先复用 core 接缝(理想接缝数为 1,即 core)。

## Out of Scope

- 多端自动同步(WebDAV/Gist/后端):第一版仅手动 CSV 导入导出。
- 其他背单词 APP(有道/百词斩/墨墨):第一版只做不背单词;但数据模型 flags 位已预留。
- YouTube 字幕、GitHub markdown 专项采集:第一版只做网页正文。
- 网页全文持久化、学习进度、推送历史、失败原因审计、可恢复任务队列:第一版不做。
- 申请 cookies/notifications 等权限:第一版不申请,用最小权限。
- 不背单词「自制词书」批量上传子系统(lexis):第一版不用(用逐词加生词本接口)。
- 把不背单词 cookie 读出/转发/上传:永不做(安全边界)。
- **单词熟悉度/记忆状态获取**(0-100 连续指标,或生/模糊/熟悉离散态):技术不可行 —— 不背单词网页端 API 全集(7 个端点:`/api/{user-new-word, remove-user-new-word, check-login, check-new-word}` + `/lexis/book/{list,coolcode,file/submit,save,delete}`)无一返回熟悉度;官方查词插件源码也无任何熟悉度/记忆强度字段;生词列表响应只有 `word/ukpron/uspron/updatetime`。算法记忆状态(FSRS-like)只存 APP/服务端,网页端零暴露。能用 `check-new-word` 做的二值「在/不在生词本」过滤已在第一版计划内,等价于「还没开始学」的最粗糙近似,**不等于熟悉度**。

## Further Notes

- **关键风险已消除**:不背单词加词接口(最不确定的链路)已通过逆向官方插件 + 真实账号加/删词验证,确认逐词加生词本可行、纯 cookie 鉴权、无 token/CSRF。剩余风险是网页提取质量、lemma 准确度、MV3 生命周期、接口限频(均已有缓解:多信号过滤、compromise+不规则表、每次重开 DB、串行+退避)。
- **方法教训**:网页 UI 的能力 ≠ 后端 API 的能力。不背单词网页 UI 只暴露批量建词书,但官方查词插件揭示了一个支持逐词加的隐藏接口。调研第三方平台接口时,逆向官方插件是找隐藏 API 的高效路径。
- 接下来可选用 `to-tickets` 把本 spec 拆成 tracer-bullet 工单(骨架 → core → 扩展(content/worker/popup)→ CLI → 联调),每个工单是纵向切片、声明阻塞边。
