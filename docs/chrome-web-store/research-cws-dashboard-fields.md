# research-cws-dashboard-fields.md — Chrome Web Store Dashboard 字段实测调研

> 目的：把「发布/更新一个扩展版本」时 Dashboard 上的字段口径、约束、必填项、来源（自动 vs 手填）落实清楚，给 `chrome-extension-release` skill 的 SUBMISSION 手册模板提供材料规范的修订依据。
>
> 调研日期：2026-08-22
>
> 调研方法：
> 1. **Dashboard 端实测（2026-08-22）**：team-lead 通过宿主机 Chrome（代理 + CDP 9223、用户已登录）逐 tab dump 了 WordRadar 商品 Dashboard。原始 dump 在 `/tmp/cws-dumps/`：
>    - `00-current.txt` — Dashboard 内容列表
>    - `10-edit-current.txt` — 商品详情（listing）
>    - `20-package.txt` — 文件包 tab
>    - `20-privacy.txt` — 隐私权 tab
>    - `20-distribution.txt` — 分发 tab
>    - `20-status.txt` — 状态 tab
>    - `30-testcredentials.txt` — 测试说明独立页（左侧 sidebar，URL 后缀 `/testcredentials`）
>    - `nav-links.json` / `edit-nav.json` / `access-nav.json` — 导航结构
> 2. **官方文档调研（2026-08-22 前期）**：通过 WebFetch / WebSearch 抓取 `developer.chrome.com/docs/webstore/*` 子页面与第三方引用 — **实测数据优先；官方文档用于补足或交叉验证**。
>
> 本文以**实测 dump 为权威来源**；官方文档仅作交叉验证。所有结论在每个表格的「来源」列显式标注。

## 1. Dashboard 主框架（来源：edit-nav.json + access-nav.json 实测）

WordRadar 商品编辑入口 URL 模式：

```
https://chrome.google.com/webstore/devconsole/{publisherId}/{extensionId}/edit/{tab}
```

| Tab / 页面       | URL 后缀          | 作用                                            | 状态（实测 2026-08-22） |
| ---------------- | ----------------- | ----------------------------------------------- | ---------------------- |
| 状态             | `/edit/status`    | 当前版本草稿/已发布状态、审核进度                 | **待审核**（2026-08-21 提交） |
| 文件包           | `/edit/package`   | 上传新包 / 显示已上传包的自动字段                 | 0.1.0 已上传、Ready       |
| 商品详情         | `/edit/listing`   | 商店展示信息（标题、摘要、说明、类别、图、语言） | 描述 720 字符已填         |
| 隐私权           | `/edit/privacy`   | 单一用途、权限理由、远程代码、数据使用、隐私政策 URL | 单一用途 35、权限理由 4 框  |
| 分发             | `/edit/distribution` | 付款、公开范围、地区                             | 默认 公开/免费            |
| **访问权限**（左侧 sidebar 独立页） | （左侧导航）       | 哪些 Google 账号可访问（私享/可信测试员）         | 默认发布者本人             |
| **测试说明**（左侧 sidebar 独立页） | `/testcredentials` | 给 CWS 审核者的测试账号 + 说明                    | 已保存 2026-08-21         |

> 「访问权限」与「测试说明」**不是 edit/ 子 tab**，而是左侧 sidebar 上的两个独立页面。

新发布者上限：当前 = 已发布 2 个扩展、上限 3 个（Dashboard 列表顶部提示，来源 `00-current.txt`）。

## 2. Package（文件包）tab

来源：`/tmp/cws-dumps/20-package.txt`。

| 字段          | 值（实测）                                 | 自动/手填 | 备注                                                                                          |
| ------------- | ------------------------------------------ | --------- | --------------------------------------------------------------------------------------------- |
| 上传控件      | "上传新的软件包"按钮                        | 手填      | 选择本地 zip                                                                                   |
| 版本          | `0.1.0`                                    | **自动**  | 从 zip 内 `manifest.json` 的 `version` 字段读入                                               |
| 内容类型      | `扩展程序`                                  | **自动**  | 同上                                                                                            |
| 权限          | `storage, activeTab, scripting, host permission` | **自动**  | Dashboard 合并展示：3 个 API 权限单列 + 1 个「host permission」汇总 — 与 Privacy tab 的 4 框结构**完全一致** |
| CRX 文件      | `main.crx`                                  | **自动**  | 由 zip 自动生成                                                                                |
| 公钥          | "查看公钥"链接                              | **自动**  | CRX 签名密钥                                                                                   |
| 选择启用      | 开关                                        | 手填      | 控制草稿 → 发布的启用                                                                          |

**结论：Package tab 不需要手填文案，所有字段来自 zip**。本项目策略：以生产 manifest 为唯一来源，verify:manifest 已断言三方一致（FACTS.md §3）。

## 3. Store listing（商品详情）tab

来源：`/tmp/cws-dumps/10-edit-current.txt`。

### 3.1 产品详情（自动 vs 手填分区）

| 字段         | 实测来源              | 自动/手填 | 字符上限（实测计数）                                          | 本项目做法 |
| ------------ | ------------------- | --------- | -------------------------------------------------------------- | --------- |
| 标题         | "软件包中的标题" 框  | **自动**（来自 zip manifest.name） | 未显示上限框（覆盖即可）                                       | manifest.name = `WordRadar` |
| 摘要         | "软件包中的摘要" 框  | **自动**（来自 zip manifest.description 或 STORE-LISTING）  | 未显示上限框（覆盖即可）                                       | 由 STORE-LISTING「简短描述」text 块控制 |
| 说明         | 说明 textarea       | 手填      | **16,000**（实测："已输入 720 个字符，最多可输入 16000 个"）  | STORE-LISTING「详细描述」text 块 |
| 类别         | 类别单选            | 手填      | 单选；当前 Dashboard 值 = **教育**（实测 `10-edit-current.txt:45`）— **与 STORE-LISTING「效率工具 / Productivity Tools」冲突**（详见 [§12.1](#121-类别冲突)） |
| 语言         | 语言单选            | 手填      | 单选；当前值 = `中文（中国）`（实测 `10-edit-current.txt:47`） | 本项目唯一语言集 = zh（FACTS.md §4） |

### 3.2 图片资源

来源：`/tmp/cws-dumps/10-edit-current.txt` §"图片资源"。

| 素材              | 画布尺寸       | 格式                                                                          | 数量        |
| ----------------- | -------------- | ----------------------------------------------------------------------------- | ----------- |
| 商店图标           | **128×128 像素** | 图片指南（未在本 tab 写明 alpha，实测有"符合图片指南"提示）                | 1 个         |
| 屏幕截图           | **1280×800 或 640×400** | **JPEG 或 24 位 PNG（无 alpha 透明层）**                                       | **1–5 张**  |
| 小型宣传图块        | **440×280 画布** | **JPEG 或 24 位 PNG（无 alpha 透明层）**                                       | 可选 1 个    |
| 顶部宣传图块        | **1400×560 画布** | **JPEG 或 24 位 PNG（无 alpha 透明层）**                                       | 可选 1 个    |

> **新发现——图片 alpha 限制**：屏幕截图 / 小型宣传图块 / 顶部宣传图块均要求"无 alpha 透明层"。本项目 `pnpm screenshot` 产出 PNG 时需确保不带 alpha（必要时预处理）。商店图标 128×128 的 alpha 限制未在本 tab 文本明示，但通常一致。

### 3.3 其他字段

| 字段            | 实测计数                                          | 必填/可选                  | 备注                                                                                          |
| --------------- | ------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| 官方网址         | 当前 = "无" 或 "或添加新网站"                    | 可选                       | 实测页面有该字段（`10-edit-current.txt:85`），可从已验证网站列表中选或新增                      |
| 首页网址         | `42/2,048`                                       | 可选，≤ 2,048 字符         | 当前填 = `https://github.com/seven-steven/word-radar`                                          |
| 支持信息页面网址 | `42/2,048`                                       | 可选，≤ 2,048 字符         | 当前填 = `https://github.com/seven-steven/word-radar/issues`（按 STORE-LISTING §支持与官网 URL） |
| 成人内容复选框   | 未勾                                              | 必勾确认（不勾为默认）     | "少儿不宜"提示语；本项目**不勾**                                                                |
| 商品支持         | "公开范围..." 区块                                 | 链接到分发 tab             | 非本页字段                                                                                     |

### 3.4 与 SUBMISSION 手册的偏差

| # | 现有描述                                       | 偏差                                                                                                  |
| - | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1 | "标题" 写为手填                                | **新发现**：标题与摘要**自动从 zip manifest 提取**，Dashboard 显示为"软件包中的标题/摘要"——本项目策略 = **不覆盖**（以 manifest 为唯一来源） |
| 2 | 截图规格未列 "无 alpha 透明层"                 | **新增** alpha 限制；`pnpm screenshot` 需确认产物不带 alpha                                            |
| 3 | 截图规格未列 "640×400"备选尺寸                 | **新增** 640×400（与 1280×800 等比小尺寸）                                                            |
| 4 | 未列"官方网址"独立字段                         | **新增**：本项目无官方网址，Dashboard 默认 "无"                                                          |
| 5 | 未列"成人内容"复选框                           | **新增**：本项目不勾                                                                                  |
| 6 | 类别写"效率工具 / Productivity Tools"          | **冲突**：Dashboard 当前实测 = **教育**（详见 [§12.1](#121-类别冲突)）                              |

## 4. Privacy（隐私权）tab

来源：`/tmp/cws-dumps/20-privacy.txt`。

### 4.1 单一用途

| 字段            | 上限（实测）     | 本项目值（来源 STORE-LISTING）                                |
| --------------- | ---------------- | -------------------------------------------------------------- |
| 单一用途说明     | **1,000 字符**（实测 "35/1,000"） | "从用户当前浏览的网页中提取英文生词，并推送到用户的「不背单词」生词本。" |

### 4.2 权限理由（**关键实测**）

> **实测发现**：Dashboard 渲染的是 **4 个 textarea**（不是 5 个）：
> 1. "需请求 storage 的理由" — `52/1,000`
> 2. "需请求 activeTab 的理由" — `53/1,000`
> 3. "需请求 scripting 的理由" — `69/1,000`
> 4. "需请求**主机权限**的理由" — `182/1,000`（**所有 host_permissions 合并为一个框**）
>
> 即：3 个 API 权限各一框；**所有 host_permissions 合并到最后一个框**——本项目 `https://bbdc.cn/*` + `https://langeasy.com.cn/*` 两条 host 理由在 Dashboard 上**只对应一个 textarea**。
>
> STORE-LISTING.md「权限理由」text 块**保持 5 条理由**（不变），但 skill 与 SUBMISSION 操作步骤需注明"host 框合并"。

| Dashboard 输入框              | 上限         | 来源                                                                            |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------- |
| 需请求 storage 的理由          | **1,000**    | STORE-LISTING「权限理由」text 块第一条                                          |
| 需请求 activeTab 的理由        | **1,000**    | 第二条                                                                            |
| 需请求 scripting 的理由        | **1,000**    | 第三条                                                                            |
| 需请求**主机权限**的理由        | **1,000**    | **第四条 + 第五条**（bbdc.cn 理由 + langeasy.com.cn 理由合并写入同一框）         |

### 4.3 远程代码声明

| 控件          | 实测形态                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| "您正在使用远程代码吗？" | 单选：`不，我并未使用远程代码`（默认）/ `是的，我在使用远程代码` |
| 理由          | textarea，**0/1,000**；**仅当选"是的，我在使用远程代码"时才需填写**            |

> 本项目 manifest 无 `unsafe-eval`、无外部 `<script>`、无 `eval()`，**选"不"**。理由框保留 0 字符即可。

### 4.4 数据使用（**关键实测——9 类**）

> 实测 9 个勾选项（不是 8 类），按页面出现顺序：

| Dashboard 标签           | 英文对应（推测）                | 本项目勾选 |
| ------------------------ | -------------------------------- | ---------- |
| 个人身份信息             | Personally identifiable information | **不勾** |
| 健康信息                 | Health information                 | **不勾** |
| 财务和付款信息           | Financial and payment information | **不勾** |
| 身份验证信息             | Authentication credentials        | **勾**（复用 bbdc cookie 鉴权） |
| 个人通讯                 | Personal communications           | **不勾** |
| 位置                     | Precise location                  | **不勾** |
| 网络记录                 | Website history                    | **不勾** |
| 用户活动                 | User activity                      | **不勾** |
| 网站内容                 | Website content                   | **勾**（采集当前页文本） |

> 9 类即"勾 2 项 + 不勾 7 项"。STORE-LISTING「隐私做法标签」text 块用中文描述，方向正确，但**漏列 2 项**（用户活动、个人身份信息）。详见 [§12.2](#122-data-usage-类别数与漏列项)。

### 4.5 强制确认复选框（Limited use 认证）

实测有 3 个**必勾**复选框，且**全选才符合政策**：

| # | 文案（实测中文）                                            | 必勾 |
| - | ---------------------------------------------------------- | ---- |
| 1 | 我不会出于已获批准的用途之外的用途向第三方**出售或传输**用户数据 | ✓   |
| 2 | 我不会为实现与我的产品的**单一用途无关的目的**而使用或转移用户数据 | ✓   |
| 3 | 我不会为**确定信用度或实现贷款**而使用或转移用户数据        | ✓   |

> **实测原文**："您必须将这 3 个复选框全都选中，才符合我们的开发者计划政策。"——Dashboard 强制勾选，未勾则不能提交。

### 4.6 隐私权政策网址

| 字段          | 上限（实测）  | 必填       | 本项目来源                                |
| ------------- | ------------- | ---------- | ------------------------------------------ |
| 隐私权政策网址 | **2,048**（实测 "87/2,048"） | **必填**（标注 `*`） | `https://github.com/seven-steven/word-radar/blob/v<version>/docs/chrome-web-store/PRIVACY.md` |

### 4.7 与 SUBMISSION 手册的偏差

| # | 现有描述                                                  | 偏差 / 修正                                                                              |
| - | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1 | "权限理由（逐条，5 个 token）"                            | **修正**：Dashboard 实测 = 3 个 API 框 + 1 个 host 合并框 = **4 框**；STORE-LISTING「权限理由」text 块 5 条**保持不变**，但操作步骤需注明"host 框合并" |
| 2 | "Data usage 勾选" 行未列 9 类与中英映射                    | **新增**：按 [§4.4](#44-数据使用关键实测9-类) 表格对齐；本项目勾"身份验证信息 + 网站内容"  |
| 3 | 未列 Remote code 单选与理由 textarea                     | **新增**：默认选"不，我并未使用远程代码"                                                |
| 4 | 未列 3 条强制确认复选框                                  | **新增**：三条 Limited use 认证勾选项，必须全选                                          |
| 5 | 未明示"隐私权政策网址 必填 + 2,048 上限"                  | **新增**：Dashboard 标注 `*`，必填                                                        |

## 5. Distribution（分发）tab

来源：`/tmp/cws-dumps/20-distribution.txt`。

| 区块       | 控件                                  | 实测取值                                                                 |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------- |
| 付款       | 单选：免费 / 包含应用内购商品          | 默认 `免费`；本项目 = 免费                                                |
| 公开范围   | 单选：公开 / 不公开 / 私享 / 无        | 默认 `公开`；本项目 = 公开                                                  |
| 分发地区   | 多选 / 反向选项                       | 实测页面有"所有未列出的地区" + 各国列表（中国、台湾、香港等）             |

> **Dashboard 文档表述差异**：实测分发地区选项是"所有未列出的地区（默认） + 个别国家"双向选择；勾国家 = 在该国**不**分发。本项目默认 = 全球公开（无需勾任何国家）。

## 6. Test instructions（测试说明）独立页

来源：`/tmp/cws-dumps/30-testcredentials.txt`、`/tmp/cws-dumps/access-nav.json`。

| 字段       | 上限（实测） | 必填 | 备注                                                |
| ---------- | ------------ | ---- | --------------------------------------------------- |
| 用户名      | **100** 字符  | 条件必填 | "用于测试扩展程序的用户名"                        |
| 密码        | **100** 字符  | 条件必填 | "提供的用户名对应的密码（如果有）"                |
| 其他说明    | **500** 字符  | 可选 | "如果除了输入提供的用户名和密码之外..."           |

> 该页**支持多条凭证**（实测有"修改 / 删除"按钮），即可在该页加多条 {用户名、密码、其他说明}。本项目为第一版，建议**只填一条**（bbdc 测试账号）。

**与 SUBMISSION 手册的偏差**：原 SUBMISSION 表格写"位置：Dashboard「Account access / 测试账号」栏"。实测**没有 "Account access" tab**——准确说法是"测试说明"独立页（URL `/testcredentials`）。详见 [§12.3](#123-account-access-命名修正)。

## 7. 仪表盘外的关键约束（汇总）

- **新发布者扩展上限**：发布后放宽（实测当前 = 已发布 2 / 上限 3）。
- **包大小上限**：2 GB（来源：官方文档 [publish 页](https://developer.chrome.com/docs/webstore/publish)）。
- **隐私政策 URL**：必填，上限 2,048 字符（实测）。
- **数据使用 9 类**：勾选项字面中译如上；本项目勾"身份验证信息 + 网站内容"。
- **Limited use 三条强制勾选**：未全选则不能提交。
- **远程代码默认 "不"**：本项目 manifest 无远程代码。

## 8. 对 SUBMISSION 手册模板的影响清单（**按实测复核**）

> 列出现有 `docs/chrome-web-store/SUBMISSION-v0.1.0.md` 与 `.claude/skills/chrome-extension-release/references/{cws-materials,submission-template,permission-justification}.md` 应增/删/改的条目。**所有改动均以本报告 [§1–§7](#1-dashboard-主框架) 实测字段为准**。

| #  | 优先级 | 影响对象                                                                  | 现状                                                                  | 建议改动                                                                                                                                                                                          |
| -- | ------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | 高     | SUBMISSION §3 Privacy 表格 / cws-materials.md Privacy 段                  | 缺 Remote code 单选                                                   | **新增**：默认 `不，我并未使用远程代码`；理由框留 0/1,000。                                                                                                                                          |
| 2  | 高     | SUBMISSION §3 Privacy 表格 / cws-materials.md Privacy 段                  | 缺 3 条 Limited use 强制勾选                                         | **新增**：3 条全勾；引用 STORE-LISTING「隐私做法标签」text 块已有表述。                                                                                                                              |
| 3  | 高     | SUBMISSION §3 Privacy 表格 / submission-template.md                       | "权限理由（逐条）"表述模糊                                            | **修正**：实测是 **3 个 API 框 + 1 个 host 合并框 = 4 框**；SUBMISSION 操作步骤需注明"host 框合并"。                                                                                                  |
| 4  | 高     | submission-template.md Privacy 行                                         | 缺 9 类 data usage 中英映射与勾选口径                                  | **新增**：勾"身份验证信息 / 网站内容"；不勾其他 7 类。                                                                                                                                               |
| 5  | 高     | cws-materials.md / submission-template.md                                | 隐私权政策 URL 描述模糊                                                | **修正**：必填、≤2,048 字符；标 `*`。                                                                                                                                                              |
| 6  | 中     | cws-materials.md                                                          | "标题"列写为手填                                                       | **修正**：标题与摘要**自动从 zip manifest 提取**；Dashboard 显示为"软件包中的标题/摘要"框；本项目策略 = **不覆盖**。                                                                                  |
| 7  | 中     | cws-materials.md / submission-template.md 截图行                          | 截图规格未列 "无 alpha 透明层"                                         | **新增**：JPEG 或 24 位 PNG（无 alpha 透明层）；新增 "640×400" 备选尺寸。                                                                                                                          |
| 8  | 中     | cws-materials.md / submission-template.md                                | 缺"官方网址"独立字段                                                   | **新增**：本项目无官方网址，Dashboard 默认"无"。                                                                                                                                                    |
| 9  | 中     | cws-materials.md / submission-template.md                                | 缺"成人内容"复选框                                                     | **新增**：本项目不勾。                                                                                                                                                                              |
| 10 | 中     | submission-template.md / SUBMISSION-v0.1.0.md §4                          | 写"测试账号 / Account access" 命名                                     | **修正**：实测无 "Account access" tab；准确命名为"测试说明"独立页（URL `/testcredentials`）。                                                                                                       |
| 11 | 中     | cws-materials.md / permission-justification.md                           | 测试说明字段上限未提                                                   | **新增**：用户名 ≤100、密码 ≤100、其他说明 ≤500 字符。                                                                                                                                              |
| 12 | 中     | cws-materials.md 分发段                                                  | 缺地区选项实测描述                                                     | **新增**：分发地区默认 "所有未列出的地区"（= 全球）+ 个别国家勾选 = 不分发；本项目保持默认。                                                                                                          |
| 13 | 中     | submission-template.md 上传步骤                                          | 缺 "Package tab 自动字段" 说明                                         | **新增**：上传后自动显示版本 / 内容类型 / 权限列表 / CRX 文件 / 公钥——无需手填。                                                                                                                    |
| 14 | 中     | permission-justification.md                                              | 权限理由结构描述未对齐实测                                            | **修正**：3 个 API 框 + 1 个 host 合并框 + remote code 单选 No + 3 条 Limited use 勾选。                                                                                                            |
| 15 | 低     | SUBMISSION-v0.1.0.md §2 Store listing 表                                | "类别"列写"效率工具 / Productivity Tools"；实测当前 = 教育             | **不改 STORE-LISTING.md 口径**（per team-lead 指示）；**在 SUBMISSION 操作步骤加注释"当前 Dashboard 实测为教育，若审核被驳回类目不一致，可由发版人切换；STORE-LISTING 保留'效率工具'作为理想目标"**。 |
| 16 | 低     | SUBMISSION-v0.1.0.md §2 Store listing 表                                | 截图规格未列 "1–5 张" 范围                                              | **新增**："1–5 张，1280×800 或 640×400，JPEG 或 24 位 PNG（无 alpha）"。                                                                                                                            |
| 17 | 低     | FACTS.md §7「Dashboard 待人工确认项」                                     | 字数限制 / Data usage / 截图规格 / 类别等条目实测已落地                | **可在后续 v0.2.0 cleanup 中删除**已被实测替代的"待人工确认"条目；或保留为历史记录。                                                                                                                  |
| 18 | 低     | cws-materials.md 名称字段                                                | "≤75 字符" 推测                                                       | **保留 75 字符上限占位**（未实测到名称框上限计数；Dashboard 名称框实测未显示计数）—— 在 cws-materials 加注"名称上限待实测确认"。                                                                    |

## 9. 已知未实测项（再核清单）

> Dashboard 大部分字段已实测完成；以下为本次未深入或实测无法验证的细节。

1. 名称字段字符上限（Dashboard 名称框实测**未显示计数**）—— 第三方引用说 ≤75 字符，**待实测确认**。
2. 类别完整枚举（Dashboard 当前为"教育"，未列出全部可选项）。
3. 语言完整枚举（Dashboard 当前为"中文（中国）"）。
4. 分发地区完整国家列表（实测见到 170+ 国家，未一一对照；保持 Dashboard 默认即可）。
5. 访问权限页（左侧 sidebar 另一独立页）的具体字段（默认发布者本人可访问）。
6. Mature content（成人内容）勾选的具体触发条件。
7. 提交后审核时长等运营性数据（不影响材料规范）。
8. 历史版本回滚 / 删除 / 弃用 API 等运营性操作（不在材料规范范围）。

## 10. 实测 vs 文档冲突列表（**新增**——见 §12）

详见 [§12](#12-实测冲突列表)。

## 11. 来源清单

### 11.1 实测来源（权威，2026-08-22）

- `/tmp/cws-dumps/00-current.txt` — Dashboard 内容列表（确认上限 3 个扩展）。
- `/tmp/cws-dumps/10-edit-current.txt` — 商品详情实测（标题/摘要自动、说明 16,000、类别=教育、5 类图片资源、官方网址/首页/支持信息页面字段上限）。
- `/tmp/cws-dumps/20-package.txt` — 文件包 tab（自动字段实测）。
- `/tmp/cws-dumps/20-privacy.txt` — 隐私权 tab（单一用途 1000、4 框权限理由、remote code 单选、9 类数据使用、3 条 Limited use、隐私政策 URL 必填 2048）。
- `/tmp/cws-dumps/20-distribution.txt` — 分发 tab（付款、公开范围、地区列表）。
- `/tmp/cws-dumps/20-status.txt` — 状态 tab（草稿/已发布/审核状态）。
- `/tmp/cws-dumps/30-testcredentials.txt` — 测试说明独立页（字段上限 100/100/500）。
- `/tmp/cws-dumps/edit-nav.json` / `access-nav.json` / `nav-links.json` — 导航结构。

### 11.2 官方文档来源（交叉验证）

- https://developer.chrome.com/docs/webstore/publish — Dashboard 主框架 + 上传限制（2 GB）。
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing — Store listing 字段（128×128 icon、1280×800 截图、440×280 small tile、1400×560 marquee tile）。
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy — Privacy tab（Single purpose、Permission justification 每权限一框、Data usage 复选、Limited use 认证、Remote code 二选一、Privacy policy URL）。
- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution — Distribution tab（Audience access、Trusted testers、Google Groups、Regions）。
- https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions — Test instructions tab（独立 tab，内含凭据字段）。

## 12. 实测冲突列表（**实测与 STORE-LISTING/FACTS/SUBMISSION 现存文档的差异**）

### 12.1 类别冲突

| 文档                | 类别值                       |
| ------------------- | ---------------------------- |
| STORE-LISTING.md    | `效率工具 / Productivity Tools` |
| Dashboard 实测当前   | `教育`                       |
| FACTS.md §7         | "类别：效率工具（Productivity Tools），待提交时以 Dashboard 类目实际选项为准" |

**说明**：Dashboard 当前实测值为"教育"，推测为用户首次提交时按当时理解选择的（产品用途与"语言学习"相邻类目）。STORE-LISTING 写"效率工具"是仓库约定的目标值。**per team-lead 指示，不改 STORE-LISTING 口径**；在 SUBMISSION 操作步骤中注明：当前 Dashboard = 教育，若审核对类目敏感可由发版人切换为 STORE-LISTING 约定的"效率工具"。

### 12.2 Data usage 类别数与漏列项

| 文档                         | 类别数 | 漏列项                       |
| ---------------------------- | ------ | ---------------------------- |
| STORE-LISTING.md 隐私做法标签 | 提及 5 类不勾 + 2 类勾 | 漏列 "用户活动"、"个人身份信息" |
| Dashboard 实测               | 9 类   | —                             |

**说明**：实测 9 类勾选：个人身份信息、健康信息、财务和付款信息、身份验证信息、个人通讯、位置、网络记录、用户活动、网站内容。STORE-LISTING 的"Website history / Personal communications / Health / Financial / Precise location 等全部其他项"实际只列了 5 个不勾项，漏了"用户活动"和"个人身份信息"。**per team-lead 指示，不改 STORE-LISTING 口径**；在 skill 与 SUBMISSION 操作步骤中按实测 9 类列。

### 12.3 "Account access" 命名修正

| 文档                              | 命名                       |
| --------------------------------- | -------------------------- |
| SUBMISSION-v0.1.0.md §4、cws-materials.md "人工填写项" 段、permission-justification.md 末尾 | `测试账号 / Account access` |
| Dashboard 实测                    | `测试说明`（独立页，URL `/testcredentials`） |

**说明**：实测**无 "Account access" tab**；Dashboard 实际命名是"测试说明"独立页面（位于左侧 sidebar，不在 edit/ 路径下）。**改**：所有 skill / SUBMISSION 文档将"Account access / 测试账号"统一改为"测试说明（独立页）"，URL 后缀 `/testcredentials`。

### 12.4 权限理由框数

| 文档                                       | 框数                            |
| ------------------------------------------ | ------------------------------- |
| STORE-LISTING.md「权限理由」text 块        | 5 条理由（5 个 token 各一段）    |
| SUBMISSION-v0.1.0.md §3 / submission-template.md | "5 个 token"                   |
| Dashboard 实测                              | **4 框**：3 个 API 权限各一 + 1 个 host 合并框 |

**说明**：Dashboard 把所有 `host_permissions`（manifest 中 `permissions` 字段下的 URL 匹配模式）合并为单个"需请求主机权限的理由"框。STORE-LISTING 仍按 5 条理由写**便于审稿与事实追溯**；skill 与 SUBMISSION 操作步骤需注明"host 框合并"，人工复制时把 bbdc + langeasy 两条 host 理由**合并粘贴到同一个框**。

## 13. 建议后续动作

1. **本轮**：按 [§8](#8-对-submission-手册模板的影响清单) 的高/中优先级改动，更新：
   - `.claude/skills/chrome-extension-release/references/cws-materials.md`
   - `.claude/skills/chrome-extension-release/references/submission-template.md`
   - `.claude/skills/chrome-extension-release/references/permission-justification.md`
2. **下版本清理**：等 v0.2.0 发版时把 FACTS.md §7「Dashboard 待人工确认项」中已被实测替代的条目删除。
3. **下次发版前人工实测**：在登录态浏览器里再次走一遍 5 tabs + 2 sidebar pages，把 [§9](#9-已知未实测项再核清单) 的 8 项降级为"已实测"。
4. **类目决策**：本次不动 STORE-LISTING；下次发版前由发版人决定 Dashboard 当前值"教育"是否切换到"效率工具"。