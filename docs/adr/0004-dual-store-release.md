# 双商店发布：同一份产物提交同步（Chrome Web Store + Edge Add-ons）

扩展自 v1.1.0 起只上架 Chrome Web Store，而产品文档早已承诺 Chrome/Edge 双支持（spec 用户故事、README、manual-checklist §3）。本决策把 Edge Add-ons 建成与 CWS 同等的一等发布渠道，并把仓库发版资产从单商店假设改为双商店模型。

四条支柱（2026-10-12 grilling 定稿，spec 见 issue #59）：

1. **同一份产物**：`dist/word-radar-<version>.zip`（中性命名），两商店共用同一份字节。官方文档确认 Chromium MV3 扩展代码级兼容；本扩展 API 面（storage/activeTab/scripting/contextMenus/action/i18n/tabs/runtime）零适配，唯一版本门槛 API `action.openPopup` 已由 minimum_chrome_version 127（ADR 0001）覆盖。
2. **提交同步**：每次发版两商店同时提交，接受 Edge 上线受其审核周期（最长 7 个工作日、通过即自动上线、无法控制时机）限制——两商店版本短暂不一致属预期，不触发补救动作。
3. **单一 skill**：`extension-release`（原 chrome-extension-release）编排双商店流程，共享主干（版本/build/verify/tag），商店差异下沉 references（cws-materials / edge-materials / 双提交模板）。
4. **共享事实源**：`docs/stores/FACTS.md` + `PRIVACY.md` + `screenshots/`（两商店同源，verify:claims 双向断言）；上架文案按商店分家（`stores/chrome/`、`stores/edge/` 各自 STORE-LISTING + SUBMISSION 手册，文案块自包含可整块粘贴）。

## Considered Options

- **每商店一份 zip**：为不存在的差异付税；verify-zip「恰好一个 zip」约束要放宽为两份一致性检查。否——真到需要 Edge 特有分叉的那天再引入。
- **两个 skill（chrome-extension-release 不动 + 新建 edge-release）**：版本 bump/build/tag/材料 freshness 等共享步骤要在两处各写一遍，改一处忘一处；「提交同步」要求每次发版手动跑两个 skill，编排负担回到人身上。否。
- **Edge 独立触发/固定滞后一版**：自然退化为僵尸渠道或为 <几百安装量用户群过度设计，与「一等渠道」动机矛盾。否。
- **Edge 首发即 skill 化**：补交场景（版本已 bump、tag 已存在）要求 skill 加一堆「跳过版本/跳过 tag」条件分支，一次性需求买永久的编排复杂度。否——首发手动 + SUBMISSION 手册驱动，skill 只面向后续常规发版。

## Consequences

- Edge 上架文案新增机器断言：fenced 块内不得含 "Chrome" 字样（Edge 认证拒审硬条件），`verify:claims` 逐块强制；说明层不受限。
- 终验升级为双浏览器：chromium 全量 + `--channel msedge` 核心子集（smoke/collect/push/active-tab-inject/popup）。e2e 基建（`E2E_CHANNEL`）当初已预留，零代码改动。
- 提交通道分层：首发与 listing 变更永远网页（两商店 API 均无此能力）；版本更新自 1.2.0 起走 API（CWS V2 service account / Edge Update API v1.1 API key），凭证走环境变量绝不入库。
- zip 命名从 `-chrome` 后缀改中性（v1.1.0 及更早的 GitHub Release 附件保留历史命名，不回溯）。
- v1.1.0 Edge 补交为一次性手动操作（Partner Center 网页 + `docs/stores/edge/SUBMISSION-v1.1.0.md`），上传中性命名产物（字节与已发布的 `-chrome` 命名产物一致）；隐私政策 URL 用 v1.1.0 tag 内的实际路径（与 CWS 侧提交一致），自 v1.2.0 起的手册改用迁移后路径。
