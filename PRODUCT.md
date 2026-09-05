# Product

<!-- impeccable:product-schema 1 -->

## Platform

web（Chrome/Edge 桌面浏览器扩展，MV3）

## Users

- 主要用户 = 产品作者本人（dogfooding，2026-09-05 确认）：英语学习者，日常读英文网页/wiki/文章，同时是「不背单词」（bbdc.cn）用户。产品判断以自用体验为锚。
- v0.1.0 已上架 Chrome Web Store（2026-09-05 确认；仓库内 SUBMISSION 手册成文早于实际上架，属滞后物料）。存在未知规模的陌生用户，但当前迭代不由外部用户反馈驱动——暂无可用的反馈数据。

## Product Purpose

把网页里的英文生词批量提取出来，经人工确认后一键推送进「不背单词」生词本。扩展只做「拾取」，「背」外包给成熟 APP。成功 = 作者本人在日常英文阅读中持续用扩展走完 采集 → 确认 → 推送 闭环，并持续迭代上架新版本。

## Positioning

相邻产品难以照搬的机制：

- **免密直推**：扩展复用网页登录凭证调「不背单词」网页 API，逐词直接加生词本（已逆向官方插件并用真实账号实测打通），而非截图/剪贴板/手动导入搬运。
- **极简词库模型**：CSV `lemma,flags` 位掩码（一行一词一个十进制数），lemma 去重、只记成功两态、加渠道只需定义新 bit 位。
- **人在回路**：「确认即推送」是唯一入库路径，没有自动推送开关。

## Operating Context

- 场景：桌面浏览器读英文网页。v1 采集源 = 网页正文；YouTube 字幕、GitHub md、本地文件走 CLI，均为后置。
- 核心工作流：popup 发起采集（选区 → article → main → body → `<pre>` 兜底）→ 待确认批次 → 确认闸门 → 推送不背单词 → badge 反馈（`x/y` 蓝 / `✓` 绿 / `?` 灰 / `!` 红）。
- 术语以根目录 `CONTEXT.md` 为准：采集 / 采集目标 / 新词 / 待确认批次 / 待推池 / 确认即推送 / 已存在。
- 双形态：扩展为主（词库主存储 = 扩展端 IndexedDB），CLI 为辅（本地文件/字幕/批量清洗），CSV 手动互通。
- i18n：popup 与错误文案全量 i18n，支持 en / zh_CN / zh_TW。

## Capabilities and Constraints

- 已上线能力（v0.1.0）：网页正文采集、lemma 去重、确认闸门、批量推送不背单词、badge 状态、CSV 导入导出、错误日志导出。
- 技术约束：MV3、Chrome ≥114；最小权限（`storage` / `activeTab` / `scripting`），host_permissions 仅 bbdc.cn 与 langeasy.com.cn；不读 cookie；不采集页面内容以外的数据。
- 第一版零后端为软约束：手动 CSV 互通，后续多端同步可能引入 WebDAV/Gist 或后端，架构需留口子但当前不做。
- 明确后置（PRODUCT 范围外，勿在当前迭代引入）：多端同步、有道/百词斩/墨墨渠道、营销官网。
- 数据模型以 memory `data-model` 最终版为准：CSV `lemma,flags`，bit0=不背单词已推（成功置位，失败不置位可重试），bit1–3 预留其他渠道；无 surfaceForms、无时间戳、无来源、无释义。

## Brand Commitments

- 名称锁定：「单词雷达 / WordRadar」（2026-08-16 由「拾词 WordPicker」更名，中英文档统一）。
- logo 可随视觉世界演化；当前橙黄渐变 W 矢量图（`packages/extension/src/assets/icons/word-radar.svg`）不是硬约束。
- 视觉权威：`docs/design/DESIGN.md`（Berkeley Mono man-page 世界）是所有新做与重做表面的目标视觉 spec；已上线的 #35 clean-SaaS 外观视为 pre-migration 证据，不作为设计依据。

## Evidence on Hand

- `docs/spec.md`：25 条 user stories + 全部已锁定产品决策（triage: ready-for-agent）。
- API 实测结论：「不背单词」逐词加生词本接口已逆向并打通（spec.md 技术风险条目已消除；lexis 批量词书为另一套接口，第一版不用）。
- 测试证据：vitest 单测（core/extension/cli）+ Playwright MV3 e2e（`pnpm e2e`，11/11 绿）。
- CWS 物料：`docs/chrome-web-store/`（FACTS / PRIVACY / STORE-LISTING / SUBMISSION-v0.1.0）、`docs/manual-checklist.md`。
- **缺失且不得虚构**：安装量/留存数据、用户反馈、用户证言、竞品对比结论、定价依据。

## Product Principles

1. **人在回路**：确认即推送是唯一入库路径，永不后台自动推送。
2. **拾取做轻，背诵外包**：不重复造背词轮子。
3. **极简数据**：一行一词一位掩码，能不存的字段就不存。
4. **最小权限与隐私边界优先于功能便利**。
5. **先跑通自用闭环再复制扩展**：单 APP → 多 APP，单端 → 多端同步。
