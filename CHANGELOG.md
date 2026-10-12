# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [Unreleased]

## [1.1.0] - 2026-10-12

### 新增

- 收词过滤（issue #43，ADR-0002）：采集与 CLI 清洗共用双判据——内置**缩略词黑名单**（词形还原后按小写 lemma 精确命中，docs→doc）+ **缩合形式拦截**（剥离所有格 `'s` 后仍含撇号即丢，you've/aren't/o'clock）；所有格剥离（dog's→dog）属归一化、永不受开关控制。被过滤词条不进待确认批次，确认卡报「已过滤 N 个」（网页采集与上传采集同语义，CSV 导入天然豁免）；「过滤缩略词」「过滤缩合形式」两开关默认全开，popup 工具抽屉设置组读写 `chrome.storage.local`；`extractWordEntries` 返回 `{entries, filteredCount}`，测试可注入固定黑名单
- 缩略词黑名单构建管线 `scripts/build-blacklist.mjs`：Wiktionary clipping/abbreviation/initialism 三类目 → 定义行纯度过滤（整页缩略族释义占比 ≥1/5 + **小写真词页一票否决**：大写变体页不得为未过纯度的真词担保）→ 双守卫（手工闭类词表 + Norvig 现代语料 top-5000 及其词形还原形，验收正向词 md/doc/stat 豁免守卫，issue #49 提界）+ md 种子（API 核验埃及语转写通道漏网）→ 静态资源随 core 分发；验收线（md/doc/stat 命中，serendipity/monorepo 放行）与管线级 top-1000 高频词零误杀均由数据测试钉死，重生成自检失败即非零退出

### 修复

- 黑名单误杀常用词 fox（issue #49，v2 管线残余缺陷）：Norvig 词频排名 3222 的常用真词因 Wiktionary 词条混入缩略族定义行（"fox." 处方拉丁缩写义）过纯度线入榜，静默滤掉 `the fox's den` 的 fox——根因是层2 高频守卫上界 top-1400（被 md@Norvig1464 钉死）只覆盖高排名内词，守卫外常用词裸奔；修复 = 守卫上界提至 top-5000（构造性覆盖 fox/cat/pass 类）+ 引入验收正向词守卫豁免（`ACCEPTANCE_POSITIVE` md/doc/stat，人工裁决优先于自动启发——md@1464/doc@2660 落入新守卫圈内必须豁免，验收线不漂移）；wolf@5073/hound@16452 仍在界外（再提界会误保 app@5355 类高频真缩略词），由数据测试专项断言兜底监测；黑名单全量再生成（词条数见产物头注）。构建期 top-10000 残余碰撞画像（issue 要求的规模效应审计）：top-1000 零碰撞、top-3000 仅豁免词 md/doc，守卫外（5000-10000）残余 572 词——exam/bike 类真 clipping 与 sad/silent/law 类疑似误杀并存，分桶跟踪见 #51（净增 70 词条的上游 Wiktionary 漂移同入画像）
- lemma 残余畸形 pyjamas→pyjamave（issue #50，#48 词典守门的放行路径残余）：compromise 把 -as 结尾词误判为动词三单后套拉丁式 -as→-ave 规则制造伪词（pyjamas@42581 在守门词典 top-20000 外，「双双不在典」零误杀路径放行）；扫描证实影响面远超 issue 样本——Norvig 前 200 个 -as 词 117 个中招（arenas→arenave、umbrellas→umbrellave、orchestras→orchestrave 类 -as 复数全在受害面）；修复 = finalize 双冷僻放行前加负启发（原词 -as 结尾且输出 -ave 结尾 → 回退原词形），真实英语变位只有 -ave→-aves 与 has→have（后者由不规则动词表前置拦截不进 finalize），零语义风险；seafarers→seafarer 类双冷僻正确还原不受影响
- 开 popup 的零词恢复轮噪音（issue #36）：`CHECK_LOGIN` 登录恢复路径对待推池为空时跳过整轮推送、保持 idle（对齐 `resumePendingPush` 守卫），popup 不再空转出「推送完成 + 成功 0 · 已存在 0 · 失败 0」回执，也省去零词轮的两发 `checkLogin` 网络请求
- lemma 还原畸变（issue #48）：`fixF` 对一切 -ve/-ves 结尾盲试 -f/-fe 拼接、且还原链路无词典守门，-ve 常见词被改写成非词 lemma（active→actife、give→gife、have→hafe、this→thi）直接进词库与待推池，畸形 lemma 还会让黑名单按 lemma 的精确匹配失效；修复 = 删 `fixF`、新增 `finalize` 词典级守门（Norvig top-20000）：输出在典直用 → -f/-fe 拼接形态须本身过典（knives→knife 保留）→ 畸形而原词形在典回退原词形（thi→this）→ 双双不在典（截选外冷僻词）保持还原输出零行为变化；compromise 动词/名词两出口与后缀 fallback 统一接入
- 推送运行中确认的批次被滞留（issue #47，e2e「completed EMPTY round」全量跑偶发挂的根因）：`start()` BUSY 去重静默吞掉新请求 + 轮开始时快照待推池——运行中确认的新词不在快照内，轮结束后滞留待推池直到下次触发，用户无感知；修复 = BUSY 拒入转为补轮标记（对外仍返回同一 promise，去重契约不变），轮以 completed 收尾后自动补一轮推走期间新入池的词，空轮排空自然停止不自旋；paused/异常收尾不补轮（pause 语义优先，滞留词由登录恢复/冷启动恢复兜底）

### 测试与工程

- code-review 判断题清理（issue #54）：reveal 开合单一出口——新增 `lib/reveal.ts`（`setRevealOpen`/`isRevealOpen`，`.open` class 语义只拼写一次），popup.ts 与 confirm-card.ts 都改用（原「module 内自持逐字一致的等价实现」两处持有退场；aria-expanded 仍是 tools-toggle 调用点职责）；ImportCsvOutcome/UploadFileOutcome 同构双别名合一为 `BatchOutcome`（CSV 导入/文件上传/粘贴文本三通道共用一个名，粘贴复用 Upload 名的语义错位消除；Confirm/Export 两族成功体不同构，保持独立）
- e2e 跨用例驻留批清理（issue #54 Wave D 适配）：beforeEach 走临时 popup 页发 `DISCARD_COLLECTED` 并轮询 `GET_BATCH_STATE` 双确认清掉 SW 驻留的待确认批次——覆盖闸门判定依据从 popup 影子记账（每用例重开 popup 即清零，感知不到残留）改为查询 SW 真相后，前序用例驻留的 collect/import 批会拦下后续上传用例（弹覆盖确认条而非直接上传），与 #27 的路由/页面泄漏同类。已知遗留（取证链在 #54）：极少数时序下驻留批于清理后「复活」（疑似多 SW 实例并存导致消息路由分叉），受影响上传用例单跑均绿、非本轮重构回归，专项跟踪
- code-review 修复（issue #54）：`dispatchUpload` 防重入同步前置（闸门改 async 查询 SW 真相后，`isUploading` 置位被推到 await 之后，往返窗口内快速二次输入可双双放行并发上传——Spec 轴评审发现的 TOCTOU，旧影子同步判定无此窗口；gate 查询防御性降级放行，任何异常不把 isUploading 卡死）；`resideAndRespond` 分支配置改判别联合（collect 分支无 stage 亦无 failText，空函数占位退场）
- 构建侧 core 入口稳定化（issue #54 Wave F）：build-blacklist 的 `registerHooks` 内联 loader 钩子（Node 原生加载 core TS 源所需的 .js→.ts 重写）抽出为 `scripts/lib/load-core-lemmatizer.mjs` 共享工具——「core TS 加载协议」单一持有处，构建脚本不再持有 core 内部 import 风格知识（core 改用 .ts 后缀 import 时钩子可整体删除）；加载后新增哨兵断言（went→go / knives→knife / pyjamas→pyjamas / arenas→arenas，期望值锁在 core lemma.test，覆盖 #48 守门与 #50 负启发两修复路径）——core 还原行为漂移时全量 ~2.5h 管线起步即失败，不再跑完后悄悄产出与管线行为不一致的黑名单；黑名单内容零变化（未跑再生成，冒烟实测加载与哨兵通过）
- 确认卡生命周期 module 化（issue #54 Wave E）：popup 的 render / 快照记账 / 失败恢复 / 消费清空收进 `confirm-card` module（`createConfirmCard`——DOM 网关、i18n 适配层、联动 hooks 三路注入，jsdom 单测直喂真实元素），popup 只留全局联动（D 状态行互斥、空态提示）与事件接线；#22 失败恢复语义随迁为 `restoreFromSnapshot` 返回值契约，确认/取消后 `consume()` 清快照（快照残留恢复已消费旧卡的回归由单测钉死，不再只能靠 e2e 抓）；reveal 开合工具与 toolsPanel 共享留在 popup，module 内自持等价实现；popup 净 −41 行
- 待确认批次 module 化 + 推送触发策略单点化（issue #54 Wave D）：SW 四生产分支的驻留拷贝收拢为 `pending-batch` module（单驻留、peek 只读不消费——确认合并成功才 clear、SW 内存生命周期不变），badge 重算由 set/clear 的 onChange 订阅自动触发（6 处手工 renderBadge 退场，推送 onProgress 保留）；消息协议新增 `GET_BATCH_STATE`（popup 查 SW 驻留批来源的真相查询，sw-channel 畸形应答/抛错降级 null）；popup 覆盖闸门判定依据从本地影子记账（lastBatchSource，重开弹窗即失忆）改为查询 SW 真相——popup 重开后 collect/import 驻留批被新上传静默替换的豁口关闭，决议 A5 语义补全（行为改进：popup 重开后闸门按真实驻留批询问，不再误放行）；三推送入口（确认/登录恢复/冷启动）准入策略收拢为 `push-trigger.admitPushRound` 单一决策点（confirm 无条件、恢复入口空池/查库失败跳过、冷启动另加 idle 守卫，语义与原三处注释自辩逐字对齐，issue #22/#26/#36 不变量入代码注释锚点）
- 词库仓储 lemma 归一化单一出口（issue #54 Wave C）：word-repository 内一切 lemma 比较（countNew 新词 diff、markPushed 已推标记）统一走 `normalizeLemma`，「大小写不敏感」承诺不再各方法各自实现；顺带修复 markPushed 比较两侧口径不对称（target 为小写集合而比较用库内原文，库中 lemma 非小写时永不命中——经 core 管线词条恒小写故未爆发，直写库的 TDD 用例实证修复，词条原文不重写）
- 消息协议瘦身（issue #54 Wave B）：`MARK_PUSHED` 死通道删除（popup 从不发送；逐词标记由 push-coordinator 直调仓储，`repository.markPushed` 不变）；SwChannel 透传层与收窄层合一——方法直返收窄 outcome（`Promise<unknown>` 退场，顶层 fetch*/upload* 函数删除；降级语义原样：null / confirm-unavailable / import-unavailable / upload-unavailable / export-unavailable / `{loggedIn:false}` / discard 静默，retryPush 保持透传）；PushStatus/PushProgress 同构双胞胎单点化（定义住 push-coordinator 生产者，messages 以 `PushStatus` 名 re-export，无环）；isCounts / isPushStatus 应答守卫与类型同地（messages.ts，顺手修 isCheckLoginResponse 异常缩进）；sw-channel 单测改写为 chromeSwChannel 直测（mock sendMessage：合法透传 / 畸形降级 / 抛错同降级）
- core deepening 重构（issue #54 Wave A）：收词过滤双判据收拢为 `intake-filter` module（`createIntakeFilter`——缩合 + 黑名单判据与 Set 计账单点化，extract 管线改经该 seam，两开关与黑名单注入语义不变）；`isEnglishWord` 连同全部形态正则迁至零依赖 `predicate.ts`，解 extract↔lemma import 环（两文件均改依赖 predicate，lemma←extract 方向保留）；barrel 收窄——撤下 `tokenize`、`isEnglishWord`、`normalizeText`、`isProperNoun`、`lemmatizeWord`、`ABBREVIATION_BLACKLIST`（内部实现不再上公开面，core 测试改直载 src）；词条产地共用 `createWordEntry`（extract/csv；merge 豁免——它不 trim 且须容忍未规范化输入词条）
- 词典构建管线 `scripts/build-lexicon.mjs`（issue #48）：Norvig `count_1w.txt` top-20000 静态词典生成 `packages/core/src/lexicon.ts`（gzip 84KB）；N=20000 由实测排名夹逼（覆盖线 thrive@18549 < 20000 < 排杂线 thi@20241——N 过大会让 thi 这类伪词当词典词骗过守门）；构建期自检硬断言：issue 11 词全在典、thi/actife 必不在，任一不过拒绝生成产物
- e2e harness 防睡眠加固:Playwright globalSetup 挂 `caffeinate -is -t 3600` 断言、globalTeardown 收割(darwin 专属,非 darwin 静默跳过)——本机 `pmset sleep 1` 曾让无人值守长跑 e2e 中途整机睡眠,墙钟超时在下次唤醒才被收割,伪装成「推送循环冻结在词间」的假回归(pmset 日志取证定案)
- e2e push.spec 空轮用例竞态修复（#36 复核取证发现，与 SW 修复正交、HEAD 下同样存在）：第一段终态锚由 not-running（反向断言立即评估，confirm 后 popup 短暂仍显示旧 completed 态时会瞬间通过）改为「成功 2」确定锚——第二段若与第一轮并行发起，`start()` 去重会吞掉空轮、succeeded 永不重置

## [1.0.0] - 2026-09-06

首个 Chrome Web Store 上架版本。

### 新增

- 采集确认闸门（issue #22）：采集先入确认页集中展示拟入库词条，确认后才开始入库与推送，确认为唯一路径；确认失败保留批次、采集 ack 异常显式重采、CSV 导入同过确认闸门
- 推送进度实时展示 + badge 回执（issue #23）：popup 事件驱动实时进度（替换轮询），badge 计数回执；badge 异常语义修正（`auth-expired` 与 `!` 分离）+ 推送中断后自动恢复（#26）
- 错误日志环形缓冲 + 弹窗导出（issue #25）：后台错误留痕，popup 一键导出排查
- 上传文件采集（issue #24）：popup「上传文件」按钮，`.txt` / `.md` 等纯文本文件走同一确认闸门入库；右键菜单上传入口经决策回退移除（`contextMenus` 权限同步移除）
- 全量 i18n：manifest 名称 / 描述 / 弹窗标题 `__MSG__` 化，`en` / `zh_CN` / `zh_TW`（繁体复用简体文案）三 locale，中文环境扩展名「单词雷达 WordRadar」、popup 标题「单词雷达」
- popup 视觉全面重做（issue #35 → `docs/design/DESIGN.md`）：Berkeley Mono man-page 视觉世界——JetBrains Mono 打包字体（65KB woff2，CJK 回退系统字体）、暗色 man-page title bar 头部、dot-leader 点线计数行、`[+]` / `[-]` 括号图标语言、单一 180ms 动效节奏、`prefers-reduced-motion` 全禁、`::selection` 反色与 hairline 滚动条

### 修复

- badge `?` 被残留推送回执遮蔽
- `CHECK_LOGIN` 残留 `renderBadge` 调用清理（#26 review）
- e2e shared persistent context 跨测试状态污染

### 测试与工程

- e2e 扩至 20 specs 全绿；断言钉死 zh-CN locale 跟随实际环境
- popup bundle 解耦：`CORE_VERSION` 走 `core/version` 子路径，静态资源直引不再拉入全量 core
- `verify-manifest` i18n 校验去重 + 纯函数化（issue #33）
- logo 矢量化重绘：`word-radar.svg` 从内嵌 1024px 位图的伪 SVG（945KB）重写为纯矢量路径（1KB，缩小约 900 倍）；16/48/128 PNG 从矢量源重新光栅化，边缘更干净（模糊 RMSE 0.038，残差为原位图噪点）

### 文档

- CWS Dashboard 字段结构（5 tab + 2 独立页）与上限实测报告，发版 skill 同步
- `PRODUCT.md` 捕获产品事实；`DESIGN.md` 锁定目标设计系统；README 权限表与 STORE-LISTING 随 `contextMenus` 移除同步

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

[1.1.0]: https://github.com/seven-steven/word-radar/releases/tag/v1.1.0
[1.0.0]: https://github.com/seven-steven/word-radar/releases/tag/v1.0.0
[0.1.0]: https://github.com/seven-steven/word-radar/releases/tag/v0.1.0
