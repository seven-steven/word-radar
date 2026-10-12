# Edge SUBMISSION-v<version> 模板

> 复制本模板到 `docs/stores/edge/SUBMISSION-v<version>.md` 并逐项填写。这是 Partner Center 提交当场的操作手册：每一项都写明复制来源或填写位置。
>
> 字段口径为官方文档口径（Microsoft Learn，2025-12 ~ 2026-09 更新），**未经实测**——首次提交后以实测回填；详细规范与实测缺口见 [edge-materials.md](edge-materials.md)。v1.1.0 首次补交的实例：`docs/stores/edge/SUBMISSION-v1.1.0.md`。

````markdown
# SUBMISSION-v<version> — Edge Add-ons 提交手册

- 版本：`<version>`（根 package.json / src manifest / zip 三方一致，verify:manifest ✓）
- 上传包：`dist/word-radar-<version>.zip`（verify:zip ✓；与 CWS 共用的同一份产物）
- 事实基线：[FACTS.md](../FACTS.md)（verify:claims ✓；含 Edge 专属断言：[STORE-LISTING.md](./STORE-LISTING.md) 待粘贴块无 "Chrome" 字样）
- 截图：[../screenshots/](../screenshots/) 01–03，1280×800（两商店共用）
- CWS 侧对应 Release：<GitHub Release URL>

> 本手册行文可出现 "Chrome Web Store"（对照说明，非上架文案，不受字样限制）；所有**粘贴进 Partner Center 的内容**一律取自 [STORE-LISTING.md](./STORE-LISTING.md) 的 text 块（verify:claims 已保证无 "Chrome" 字样），不改写。
> 首次提交以来已实测的部分以【实测】标注；未标注处以 Partner Center 实际表单为准，实测后回填。

## 0. 账号（已有 Partner Center 账号可跳过）

1. [Partner Center](https://partner.microsoft.com/dashboard) 用 MSA（Outlook/Live/Hotmail）或 GitHub 账号登录（工作/学校 Entra 账号不支持直接注册）。
2. 注册 Microsoft Edge 扩展开发者计划：免费，无注册费。
3. 账号类型 Individual / Company 二选一、**注册后不可更改**——本项目 = Individual。
4. 验证发布者显示名。

## 1. 上传新版本（或 Create new extension）

1. Partner Center → Edge 扩展程序 → 对应商品 → 更新（首版为 Create new extension）。
2. 拖入 `dist/word-radar-<version>.zip`，等待上传解析。
3. 自动读取（不手填）：名称 / 短描述 / 版本 / 权限列表——均来自 zip manifest，与 CWS 侧读取一致。

manifest 两条 Edge 硬要求自检：无 `update_url`；name/description 无 "Chrome" 字样（verify:claims 机器断言）。

## 2. Availability（可见性与市场）

| 字段   | 选择                           |
| ------ | ------------------------------ |
| 可见性 | **公开（Public）**             |
| 市场   | 默认**全球**（不移除任何市场） |

## 3. Properties（属性）

| 字段 | 选择 | 复制来源                                                             |
| ---- | ---- | -------------------------------------------------------------------- |
| 类别 | 单选 | STORE-LISTING「类别」text 块（以 Partner Center 类目树实际选项为准） |
| 语言 | 单选 | 中文（简体）；本项目语言集 = zh 单语言（FACTS.md §4）                |

## 4. Privacy（隐私页，2026 版含五组内容，漏填/不实可能拒审）

### 4.1 单一用途（Single purpose）

粘贴 STORE-LISTING「单一用途描述（Single Purpose）」text 块。

### 4.2 逐权限 justification（「权限理由」text 块 6 条，与生产 manifest 一一对应）

| 权限                        | 复制来源 |
| --------------------------- | -------- |
| `storage`                   | 第 1 条  |
| `activeTab`                 | 第 2 条  |
| `scripting`                 | 第 3 条  |
| `contextMenus`              | 第 4 条  |
| `https://bbdc.cn/*`         | 第 5 条  |
| `https://langeasy.com.cn/*` | 第 6 条  |

粘贴方式以实际输入框结构为准：host 共框则第 5+6 条合并（同 CWS 做法）；某权限未单出框则并入相近框尾部，并回填实测到 `references/permission-justification.md`。

### 4.3 远程代码（Remote code）

选**否**（MV3 不允许远程代码；manifest 无外部 `<script>`、无 `eval()`）；理由留空。

### 4.4 数据使用声明（Data usage + 合规认证）

按 STORE-LISTING「隐私做法与数据使用声明」text 块口径：勾网站内容 + 身份验证凭据，其余不勾；合规认证三项全勾。

### 4.5 隐私政策 URL（收集任何个人信息时必填）

```text
https://github.com/seven-steven/word-radar/blob/v<version>/docs/stores/PRIVACY.md
```

（提交前点开确认可访问；v1.1.0 补交时用的是 tag 内旧路径，见对应手册。）

## 5. Store listing（商品详情）

| 字段                               | 上限/必填                                   | 复制来源                                           |
| ---------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| 描述 Description                   | 250–10,000，每语言必填                      | STORE-LISTING「商店描述 Description」text 块       |
| 短描述 Short description           | 自动（manifest）                            | 不手填                                             |
| Search terms                       | ≤7 条、合计 ≤21 词、单条 ≤30 字符，可选     | STORE-LISTING「Search terms」text 块               |
| Extension logo                     | 1:1，推荐 300×300，最小 128×128，每语言必填 | `packages/extension/src/assets/icons/icon-128.png` |
| Screenshots                        | 640×480 或 1280×800，最多 6 张，可选        | `docs/stores/screenshots/` 三张（1280×800）        |
| 小促销图 / 大促销图 / YouTube 视频 | 可选                                        | 本项目**不传**                                     |
| 网站 / 支持 URL                    | 手填                                        | STORE-LISTING「支持与官网 URL」text 块             |

## 6. 认证备注 / 测试说明（notes for certification）

Edge 无 CWS 式独立测试账号页（`/testcredentials`）；测试信息写进认证备注：

| 内容                         | 来源                                               |
| ---------------------------- | -------------------------------------------------- |
| 测试说明（两段式）           | STORE-LISTING「测试说明（分两段）」text 块全文粘贴 |
| 测试账号（用户名/密码/方式） | 【提交时人工追加，绝不写入仓库】（FACTS.md §6）    |

## 7. 提交前最终 verify 清单

- [ ] `pnpm verify:manifest` / `verify:zip` / `verify:claims` / `verify:changelog` 全绿（当次发版流程步骤 3-5 已跑）
- [ ] `pnpm test` / 双通道 e2e 全绿（chromium 全量 + `--channel msedge` 核心子集）
- [ ] 上传的 zip 即 `dist/word-radar-<version>.zip`（dist/ 唯一版本化产物）
- [ ] 名称/描述不含 "Chrome" 字样（verify:claims 已机器断言）
- [ ] Store listing / Privacy / Search terms / logo / 截图 / 认证备注已按上表来源粘贴，不改写
- [ ] 隐私政策 URL 已点开确认可访问

## 8. 提交审核与后续

1. 点 **Submit**；状态流：In draft → In review → Waiting to publish → In the store。
2. 审核最长 **7 个工作日**；通过即自动上线（无手动发布门）——提交同步策略下属预期。
3. 版本更新走 Update API v1.1（SKILL.md 步骤 8 命令；凭证环境变量 `EDGE_ADDONS_CLIENT_ID` / `EDGE_ADDONS_API_KEY`）；listing 变更仍需网页。

## 9. 若被拒

先回 [FACTS.md](../FACTS.md) 核对事实层，再改文案层，重跑 `.claude/skills/extension-release` 发版流程。
````
