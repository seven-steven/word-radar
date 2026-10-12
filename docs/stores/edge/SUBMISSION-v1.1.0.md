# SUBMISSION-v1.1.0 — Edge Add-ons 提交手册

- 版本：`1.1.0`（根 package.json / src manifest / zip 三方一致，verify:manifest ✓）
- 上传包：`dist/word-radar-1.1.0.zip`（verify:zip ✓；与 CWS 共用的同一份产物。打包脚本已统一为中性命名 `word-radar-<version>.zip`——v1.1.0 CWS 首提时为历史命名 `word-radar-1.1.0-chrome.zip`，该命名现已不再产出）
- 事实基线：[FACTS.md](../FACTS.md)（verify:claims ✓；含 Edge 专属断言：[STORE-LISTING.md](./STORE-LISTING.md) 待粘贴块无 "Chrome" 字样）
- 截图：[../screenshots/](../screenshots/) 01–03，1280×800（两商店共用）
- CWS 侧对应 Release：https://github.com/seven-steven/word-radar/releases/tag/v1.1.0

> 本手册全部基于 Microsoft Learn 官方文档（**未实测**）。首次提交时以 Partner Center 实际表单为准，实测后回填本手册。
> 本手册行文可出现 "Chrome Web Store"（对照说明，非上架文案，不受字样限制）；所有**粘贴进 Partner Center 的内容**一律取自 [STORE-LISTING.md](./STORE-LISTING.md) 的 text 块（已由 verify:claims 保证无 "Chrome" 字样），不改写。

## 0. 账号注册（已有 Partner Center 账号可跳过）

1. 打开 [Partner Center](https://partner.microsoft.com/dashboard)，用 **MSA（Outlook/Live/Hotmail）或 GitHub 账号**登录（工作/学校 Entra 账号不支持直接注册）。
2. 注册 **Microsoft Edge 扩展开发者计划**：免费，无注册费。
3. 账号类型二选一：**Individual / Company，注册后不可更改**。本项目选 **Individual**（验证快：发布者显示名可用即可；Company 需数天到数周）。
4. 验证**发布者显示名**（将展示在商店 listing 上）。

## 1. Create new extension（上传 zip）

1. Partner Center → Edge 扩展程序 → **Create new extension**。
2. 拖入 / 选择 `dist/word-radar-1.1.0.zip`，等待上传解析完成。
3. Partner Center 从 manifest 自动读取（无需手填，以实读为准）：
   - 名称 = manifest.name（`__MSG_extName__` 解析值，与 CWS 同源）
   - 短描述 = manifest.description（`_locales` 控制；改动需重传 zip）
   - 版本 = `1.1.0`
   - 权限 = `storage, activeTab, scripting, contextMenus` + 两个 host（与 CWS 侧读取一致）

manifest 两条 Edge 硬要求已满足：无 `update_url` 字段（零改动）；name/description 无 "Chrome" 字样（verify:claims 机器断言）。官方明文同一份 Chromium MV3 zip 直接接受，所用 API（storage / activeTab / scripting / contextMenus / action i18n / tabs / runtime）全部在官方支持表内。

## 2. Availability（可见性与市场）

| 字段   | 选择                           |
| ------ | ------------------------------ |
| 可见性 | **公开（Public）**             |
| 市场   | 默认**全球**（不移除任何市场） |

（官方口径字段，以实际表单为准。）

## 3. Properties（属性）

| 字段 | 选择 | 复制来源                                                                |
| ---- | ---- | ----------------------------------------------------------------------- |
| 类别 | 单选 | STORE-LISTING「类别」＝效率工具（以 Partner Center 类目树实际选项为准） |
| 语言 | 单选 | 中文（简体）；本项目语言集 = zh 单语言（FACTS.md §4）                   |

（其余 Properties 字段官方文档未逐项列明，以实际表单为准。）

## 4. Privacy（隐私页，2026 版含五组内容，漏填/不实可能拒审）

### 4.1 单一用途（Single purpose）

| 字段         | 上限 | 复制来源                                               |
| ------------ | ---- | ------------------------------------------------------ |
| 单一用途描述 | —    | STORE-LISTING「单一用途描述（Single Purpose）」text 块 |

### 4.2 逐权限 justification（STORE-LISTING「权限理由」text 块 6 条，与生产 manifest 一一对应）

| 权限                        | 复制来源                       |
| --------------------------- | ------------------------------ |
| `storage`                   | 「权限理由」text 块第 1 条     |
| `activeTab`                 | 第 2 条                        |
| `scripting`                 | 第 3 条                        |
| `contextMenus`              | 第 4 条（v1.1.0 新增入口权限） |
| `https://bbdc.cn/*`         | 第 5 条                        |
| `https://langeasy.com.cn/*` | 第 6 条                        |

粘贴方式以实际输入框结构为准：若两个 host 共用一个框，第 5 + 6 条合并写入（同 CWS 侧做法）；若某权限未单出框，将对应条目并入相近框尾部，并回填实测结论到 skill `references/permission-justification.md`。

### 4.3 远程代码（Remote code）

| 字段             | 选择                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| 是否使用远程代码 | **否**（MV3 不允许远程代码；manifest 无外部 `<script>`、无 `eval()`） |
| 远程代码理由     | 留空（仅选"是"时填写）                                                |

### 4.4 数据使用声明（Data usage + 合规认证）

按 STORE-LISTING「隐私做法与数据使用声明」text 块口径：

- **勾**：网站内容（Website content）、身份验证凭据（Authentication credentials）
- **不勾**：其余全部项（网站历史 / 用户活动 / 个人通讯 / 健康 / 财务 / 精确位置等）
- 合规认证声明：数据不出售、不用于无关用途、不用于信用评估——**全部勾选**（与块内"不勾选"部分对应）

字段名以提交时 Partner Center Privacy 页实际表单为准，实测后回填 STORE-LISTING。

### 4.5 隐私政策 URL（收集任何个人信息时必填，须可访问并展示在 listing 上）

```text
https://github.com/seven-steven/word-radar/blob/v1.1.0/docs/chrome-web-store/PRIVACY.md
```

> **用 v1.1.0 tag 内的实际路径**（与 CWS 侧 v1.1.0 提交的 URL 完全一致、内容同一文件）：v1.1.0 打 tag 时 `PRIVACY.md` 尚在旧目录 `docs/chrome-web-store/`，补交不产生新 tag，`blob/v1.1.0/docs/stores/PRIVACY.md` 会 404。自 v1.2.0 起（目录已迁移）的新手册改用 `blob/v<version>/docs/stores/PRIVACY.md`。

## 5. Store listing（商品详情）

| 字段                                 | 上限/必填                                   | 复制来源                                                                                                      |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 描述 Description                     | 250–10,000，每语言必填                      | STORE-LISTING「商店描述 Description」text 块（约 640 字符，≥250 下限已满足）                                  |
| 短描述 Short description             | 自动（manifest）                            | **不手填**（来自 `_locales`，与 CWS 同源；改动需重传 zip）                                                    |
| Search terms                         | ≤7 条、合计 ≤21 词、单条 ≤30 字符，可选     | STORE-LISTING「Search terms」text 块（7 条中文短语；以实际计数器为准）                                        |
| Extension logo                       | 1:1，推荐 300×300，最小 128×128，每语言必填 | `packages/extension/src/assets/icons/icon-128.png`                                                            |
| Screenshots                          | 640×480 或 1280×800，最多 6 张，可选        | `docs/stores/screenshots/01-reading.png`、`02-collect.png`、`03-push.png`（1280×800，共 3 张）                |
| 小促销图 440×280 / 大促销图 1400×560 | 可选                                        | 本项目**不传**                                                                                                |
| YouTube 视频 URL                     | 可选                                        | 本项目**不传**                                                                                                |
| 网站 / 支持 URL                      | 手填                                        | STORE-LISTING「支持与官网 URL」text 块 = `https://github.com/seven-steven/word-radar`（issue 入口 `/issues`） |

## 6. 认证备注 / 测试说明（notes for certification）

Edge 无 CWS 式独立测试账号页（`/testcredentials`）；测试信息写进认证备注（所在页面位置以实际表单为准）。

| 内容                                                     | 来源                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 测试说明（两段式：第一段免登录复现采集；第二段验证推送） | STORE-LISTING「测试说明（分两段）」text 块**全文粘贴**                           |
| 测试账号（用户名 / 密码 / 登录方式）                     | 【提交时人工追加在块末，绝不写入仓库】（FACTS.md §6：任何文件不得出现账号/密码） |

支持多条凭证；本项目建议**只填一条** bbdc 测试账号。

## 7. 提交前最终 verify 清单

- [ ] `pnpm verify:manifest` / `verify:zip` / `verify:claims` / `verify:changelog` 全绿（2026-10-12 双商店改造后已重跑，verify:claims 现含 Edge 专属断言）
- [ ] `pnpm test` 全绿（631/631：core 139 + cli 29 + extension 463）；e2e 全绿（chromium 全量 46 passed / 0 failed / 1 skipped；Edge 通道核心子集 30 passed / 0 failed——同一产物双浏览器实证）
- [ ] 上传的 zip 即 `dist/word-radar-1.1.0.zip`（dist/ 下唯一版本化产物，verify:zip 断言）
- [ ] 名称/描述不含 "Chrome" 字样（verify:claims 已机器断言——Edge 认证硬条件，含该字样直接拒审）
- [ ] Store listing 每个字段已按上表来源粘贴（描述直接复制「商店描述 Description」text 块，不改写）
- [ ] Privacy 五组已填：单一用途、权限理由逐条 6 条、Remote code = 否、数据使用勾 2 类 + 合规认证、隐私政策 URL（已点开确认可访问）
- [ ] Search terms 7 条已填；logo / 3 张截图已上传（1280×800）
- [ ] 认证备注已粘贴「测试说明（分两段）」块，测试账号已人工追加且未写入仓库

## 8. 提交审核与后续

1. 点 **Submit**；状态流：In draft → In review → Waiting to publish → In the store。
2. 审核最长 **7 个工作日**（2025 年起投稿量上升、审核偏慢）；**通过即自动上线——无手动发布门、无法控制发布时机**，提交同步策略下属预期。
3. **审核通过后立即**：Partner Center「Publish API」页 → Enable → **Create API credentials**（得 Client ID + API key），为 1.2.0 起的更新 API 化做准备。注意 Update API v1.1 只能更新已发布产品（传 zip / 发 submission），不能创建新品、不能改 listing 元数据——首发通过后产品即存在，正好衔接。
4. 凭证（Client ID + API key）存本地安全处，**绝不入库**。

## 9. 若被拒

先回 [FACTS.md](../FACTS.md) 核对事实层，再改文案层，重跑 `.claude/skills/extension-release` 发版流程（skill 已由 `chrome-extension-release` 改名）。
