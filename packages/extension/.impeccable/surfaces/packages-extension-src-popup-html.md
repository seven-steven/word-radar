---
version: 1
slug: "packages-extension-src-popup-html"
primary_target: "packages/extension/src/popup.html"
related_targets: ["packages/extension/src/popup.css","packages/extension/src/popup.ts"]
---

# Surface brief — popup (extension action popup)

Scope: `packages/extension/src/popup.html`（含 popup.css / popup.ts / `_locales/**`）。Visitor mode: **Operate**。Audience: 作者本人（英语学习者 + bbdc 用户）读英文网页时打开 popup 走采集→确认→推送闭环。Constraints: MV3/CSP 字体打包、spec 锁定流程与按钮能力集、29 个 data-testid 与 e2e 断言值不变、i18n 三语 `$N` 形参兼容、e2e 全绿。Unresolved（实现时定）: popup 具体宽度（~384px 目标）、暗条 wordmark 的 ASCII 形式。

## Direction contract

**THESIS:** popup 是 man page 的运行态——采集→确认→推送读起来像一条命令的生命周期；拒绝的类别默认是 SaaS 工具弹窗（抬升卡片、阴影、大圆角、渐变进度条）。

**OWN-WORLD:** Berkeley Mono 全程（JetBrains Mono woff2 latin subset 打包，CJK 显式回退 PingFang SC / Microsoft YaHei）；cream `#fdfcfc` 画布、ink `#201d1d`、hairline `rgba(15,0,0,0.12)` 分段；容器 0px / 交互件 4px 圆角；ASCII 括号 `[+]`/`[-]` 即图标；in-product 语义梯（accent `#007aff` / success `#30d158` / danger `#ff3b30`）只用于状态，chrome 决定性灰。

**STORY:** 打开 popup 即见词库计数与采集入口；采集后确认摘要一行是全页最重的一行（确认即推送、无自动）；确认后原地过渡为推送进度面板；工具与登录态退到底部边缘。

**FIRST VIEWPORT:** 顶部 surface-dark 暗条（ASCII wordmark + 版本 + 登录态点，全页唯一暗时刻）→ cream 单列左 flush：词库三计数行（等宽数字）→ 采集按钮行（secondary 描边）→ 确认闸门（reveal，hairline 平面区块，primary ink 填充按钮）→ 推送面板（accent 纯色进度）→ `[+]` 工具抽屉 → 底栏（登录态 + 打开 bbdc）。宽 ~384px，16px body / 14px caption。

**FORM:** direct shape（local extension 豁免 concept-seed；世界由 `docs/design/DESIGN.md` 锁定，用户确认：重组信息架构 / JetBrains Mono / 头部暗条）。签名交互 = 确认闸门 reveal → 原地过渡为推送面板；motion 语法 = 单一 180ms ease-out + 骨架呼吸 + flash 数字微反馈，`prefers-reduced-motion` 全禁。

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
