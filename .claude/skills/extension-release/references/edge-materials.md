# Edge Add-ons 必交材料清单（平台层规范）

> 本页是 Edge Add-ons 平台的材料规范参考，与 [cws-materials.md](cws-materials.md)（Chrome Web Store 侧）平级：回答 Edge 首发与后续更新"有哪些字段、什么上限、哪里手填/哪里自动"。
>
> **定位：全部内容为官方文档口径（Microsoft Learn，页面更新 2025-12 ~ 2026-09），未经 Partner Center 实测。** 字段布局、计数器、勾选项字面均以提交时 Partner Center 实际表单为准；首次提交（v1.1.0 补交）后按实测回填本页（见 §7）。事实依据见 `docs/stores/FACTS.md`，文案层唯一来源是 `docs/stores/edge/STORE-LISTING.md`。

## 1. Partner Center 提交入口结构（未实测）

Partner Center 商品提交是**向导式线性步骤**（非 CWS 侧的 5 tab + 2 sidebar 结构）；首发只能走网页，listing 无导入功能、全手动填。

| #   | 官方步骤             | 备注                                             |
| --- | -------------------- | ------------------------------------------------ |
| 1   | Create new extension | 新建商品条目                                     |
| 2   | 拖 zip 上传          | 同一份 Chromium MV3 zip 直接接受，无需改包（§4） |
| 3   | Availability         |                                                  |
| 4   | Properties           | 官方文档未细化字段，提交时以实际表单为准         |
| 5   | Privacy              | 口径见 §3                                        |
| 6   | Store Listings       | 字段表见 §2                                      |
| 7   | Submit               | 提交认证                                         |

> 与 CWS 侧结构对照：Chrome Web Store 商品编辑 = 5 tab（状态/文件包/商品详情/隐私权/分发）+ 2 sidebar 独立页（访问权限/测试说明）；Edge 侧为上述线性步骤，且**没有独立的测试账号页**——测试凭证随提交写入认证备注（见 §3.6）。

> 账号前提：Partner Center 注册免费（无注册费）；MSA（Outlook/Live/Hotmail）或 GitHub 账号登录，不支持工作/学校 Entra 账号直接注册；Individual / Company 二选一且**注册后不可更改**——本项目决策 = Individual（验证快；Company 需数天到数周）。

## 2. Store listing 字段表（官方口径，未实测）

Listing 按语言填写，本项目沿用单一中文语言集（与 CWS 同源，FACTS.md §4），每语言字段只填 zh 一份。`docs/stores/edge/STORE-LISTING.md` 各 ```text 块是文案层唯一来源，直接复制粘贴。

### 2.1 图片素材

| 素材           | 官方要求                                   | 必填/可选  | 本项目做法                                                                                   |
| -------------- | ------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| Extension logo | 1:1，推荐 300×300，最小 128×128            | 每语言必填 | manifest 内置图标最高 128×128（满足下限、低于推荐值）；是否另制 300×300 提交时定，待实测回填 |
| Screenshots    | 最多 6 张，仅 640×480 或 1280×800 两种尺寸 | 可选       | `pnpm screenshot` 产出 1280×800，与 Edge 允许尺寸重合，直接复用；上传张数提交时定            |
| 小促销图       | 440×280                                    | 可选       | **不传**                                                                                     |
| 大促销图       | 1400×560                                   | 可选       | **不传**                                                                                     |

> 截图口径对照：CWS 侧 1280×800 或 640×400、1–5 张；Edge 侧另一种允许尺寸是 640×480（非 640×400）、上限 6 张且整体可选——1280×800 产出两侧通用，无需为 Edge 另出图。

### 2.2 文本字段

| 字段              | 官方要求                              | 必填/可选    | 本项目做法                                                   | 文案层来源                                   |
| ----------------- | ------------------------------------- | ------------ | ------------------------------------------------------------ | -------------------------------------------- |
| Description       | 250–10,000 字符                       | 每语言必填   | 现稿约 640 字符，满足上下限                                  | STORE-LISTING「商店描述 Description」text 块 |
| Short description | 来自 zip manifest（改动需重传 zip）   | 至少一个语言 | 不手填；manifest description 经 `_locales` 注入，与 CWS 同源 | STORE-LISTING「短描述」节（声明不维护）      |
| Search terms      | 最多 7 条、合计 ≤21 词、单条 ≤30 字符 | 可选         | 填 7 条中文短语                                              | STORE-LISTING「Search terms」text 块         |
| YouTube video URL | 需关闭广告                            | 可选         | 不填                                                         | —                                            |

### 2.3 官方文档未给口径的字段（占位，实测后回填）

| 字段          | 本项目做法                                                                         |
| ------------- | ---------------------------------------------------------------------------------- |
| 类别          | 效率工具；STORE-LISTING「类别」text 块；提交时以 Partner Center 类目树实际选项为准 |
| 官网/支持网址 | 均填 GitHub 仓库 URL；STORE-LISTING「支持与官网 URL」text 块；字段口径未实测       |

## 3. Privacy 页口径（与 CWS 同构，字段布局未实测）

2026 版 Privacy 页要求：Single Purpose 描述、**逐权限 justification**、remote code 声明（MV3 不允许远程代码）、数据使用类型勾选 + 合规认证；漏填或不实可能拒审。**口径与 CWS 侧同构**——事实依据同为 `docs/stores/FACTS.md` + [permission-justification.md](permission-justification.md)，但 Edge 页面的字段布局、勾选项字面、字符上限未实测。

### 3.1 Single Purpose（单一用途）

| 字段         | 本项目做法 | 文案层来源                                             |
| ------------ | ---------- | ------------------------------------------------------ |
| 单一用途描述 | 直接粘贴   | STORE-LISTING「单一用途描述（Single Purpose）」text 块 |

### 3.2 逐权限 justification

| 官方要求       | 本项目做法                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 逐权限给出理由 | STORE-LISTING「权限理由」text 块按生产 manifest 6 个权限 token（storage / activeTab / scripting / contextMenus / 两个 host 域）逐条成文，逐条粘贴 |

> 与 CWS 侧差异：CWS Dashboard 实测为 3 个 API 框 + host 合并 1 框（cws-materials.md §3.2）；Edge 官方口径是"逐权限"，两个 host 域是否需合并输入以实际表单为准，待实测。

### 3.3 remote code 声明

| 控件        | 本项目选择 | 依据                                                   |
| ----------- | ---------- | ------------------------------------------------------ |
| remote code | **否**     | MV3 不允许远程代码；FACTS.md §2 数据流向（无远程代码） |

### 3.4 数据使用勾选 + 合规认证

| 项           | 本项目勾选                                                                              | 文案层来源                                     |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 数据使用类型 | 勾「网站内容 Website content」「身份验证凭据 Authentication credentials」，其余全部不勾 | STORE-LISTING「隐私做法与数据使用声明」text 块 |
| 合规认证     | 确认不出售数据、不用于无关用途、不用于信用评估                                          | 同上（块尾三行声明）                           |

> 勾选项中文名以提交时 Partner Center 实际字面为准，待实测。

### 3.5 隐私政策 URL

| 字段         | 官方要求                                                                    | 本项目填法                                                                                                            |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 隐私政策网址 | URL 形式；**收集任何个人信息时必填**；须可访问、内容最新；展示在 listing 上 | `https://github.com/seven-steven/word-radar/blob/v<version>/docs/stores/PRIVACY.md`（随版本 tag 固定，与 CWS 侧同构） |

### 3.6 测试说明

Edge 无 CWS 式 `/testcredentials` 独立页：测试凭证随提交写入**认证备注**——首发网页表单的测试说明字段；走 API 更新时为 POST submissions body 的 notes for certification JSON（§6）。文案来源 = STORE-LISTING「测试说明（分两段）」text 块；bbdc 测试账号本身仅填 Partner Center，不入仓库（FACTS.md §6）。

## 4. 认证硬条件

| 条件                     | 官方要求                                                              | 本项目状态                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name/description 禁词    | listing 的 name/description 含 "Chrome" 字样直接拒审                  | manifest name/description 现值不含该字样；Edge 文案层由 `pnpm verify:claims` 对 `docs/stores/edge/STORE-LISTING.md` 逐 fenced 块机器断言（词边界匹配；说明层文字、chromium 内核名与 chrome:// 字面量不受限）。manifest 技术键（如 `minimum_chrome_version`）不属于该判定范围，保留不动 |
| manifest 无 `update_url` | 包内 manifest 必须删除该字段                                          | 源 manifest 本就没有，零改动                                                                                                                                                                                                                                                           |
| API 兼容                 | Chromium 扩展 API 与 manifest 键与 Edge 代码级兼容，同一 zip 直接接受 | 所用接口（storage / activeTab / scripting / contextMenus / action.i18n / tabs / runtime）全部在官方支持表内                                                                                                                                                                            |
| Firefox 专属键           | `browser_specific_settings`（gecko）不需要也不建议加                  | 未加                                                                                                                                                                                                                                                                                   |

## 5. 审核与发布

| 事项     | 官方口径                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| 审核时长 | 最长 7 个工作日（"up to seven business days"）；2025 年起社区反馈因 AI 扩展投稿激增审核偏慢（非官方口径，供预期管理） |
| 状态流   | In draft → In review → Waiting to publish → In the store；已上架产品更新显示 "In the store. Update in review"         |
| 发布时机 | **无手动发布/跳过审核选项**：审核通过即自动上线，开发者无法控制发布时机                                               |

> 对发版节奏的含义：本项目以 CWS 为主商店、Edge 提交同步跟随（v1.1.0 补交首发），叠加更长的审核窗口——**Edge 上线时间天然滞后于 CWS，属预期**。

## 6. 更新通道（1.2.0 起）

首发与 listing 变更必须走网页（§1）；**已发布产品的版本更新**可走 Edge Update REST API v1.1——与 CWS 侧（Chrome Web Store API V2，service account）构成对称的两商店模型：首发/listing 变更网页，版本更新 API。

### 6.1 API 概要

| 项             | 口径                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root           | `https://api.addons.microsoftedge.microsoft.com`                                                                                                        |
| 认证           | API key 方案：请求头 `Authorization: ApiKey $ApiKey` + `X-ClientID: $ClientID`；旧 v1 OAuth 已于 2024-12-31 终止                                        |
| ① 传包         | `POST /v1/products/{productID}/submissions/draft/package`（Content-Type: application/zip；202 + Location 头含 operationID）                             |
| ② 查传包状态   | `GET /v1/products/{productID}/submissions/draft/package/operations/{operationID}`（status: InProgress / Succeeded / Failed + errorCode）                |
| ③ 发布         | `POST /v1/products/{productID}/submissions`（body 带 notes for certification JSON）                                                                     |
| ④ 查发布状态   | `GET /v1/products/{productID}/submissions/operations/{operationID}`（status=Succeeded 即提交成功，随后进认证审核）                                      |
| productID 来源 | Partner Center → Microsoft Edge > Overview → 点选扩展 → Extension overview 页 Extension identity 区的 Product ID（无 products list API，UI 是唯一来源） |

### 6.2 边界与凭证

- **只能更新已发布产品**：不能创建新产品、不能改 listing 元数据——这两件事必须网页（§1）。
- 凭证创建入口：Partner Center **"Publish API"** 页（Microsoft Edge 程序下左侧导航）→ （旧版界面先点 Enable 切换新体验）→ Create API credentials，得到 Client ID + API key——**立即抄录**（key 只在创建后立即可见，页面同时列出每个 key 的 Expiry 过期日期；过期需回该页重新 Create 续期，会生成新 key）。
- 本项目凭证走环境变量（约定 `EDGE_ADDONS_CLIENT_ID` / `EDGE_ADDONS_API_KEY`），**绝不入库**（与 FACTS.md §6 测试账号同一纪律）。

### 6.3 两商店对称模型

| 事项         | CWS 侧                                     | Edge 侧                                |
| ------------ | ------------------------------------------ | -------------------------------------- |
| 首发         | Developer Dashboard 网页                   | Partner Center 网页                    |
| listing 变更 | Dashboard 网页（更新 API 不支持）          | Partner Center 网页（更新 API 不支持） |
| 版本更新     | Chrome Web Store API V2（service account） | Edge Update API v1.1（API key）        |
| 审核时长     | 数小时到数天                               | 最长 7 个工作日                        |

启用时点：首发补交（v1.1.0）上架成功后，自 v1.2.0 起版本更新可切 API。

## 7. 引用方式与实测缺口

- 一切对外声明的事实依据在 `docs/stores/FACTS.md`；文案改动必须能回溯到 FACTS，`pnpm verify:claims` 断言一致性。FACTS 变则先改 FACTS 再改文案层（同 cws-materials.md §9）。
- 权限理由口径细节：[permission-justification.md](permission-justification.md)（与 CWS 侧共用）。
- **实测缺口**：本页全部为官方文档口径（Microsoft Learn，页面更新 2025-12 ~ 2026-09；调研日 2026-10-12），**未经 Partner Center 实测**——层级低于 cws-materials.md 的"实测 dump"惯例（实测 dump 2026-08-22，原始文件 `/tmp/cws-dumps/`）。
- 首次提交（v1.1.0 补交）后以实测回填本页：§1 实际步骤命名与表单结构、§2 字段布局与计数器、§3 Privacy 页勾选项字面与框数，并按 cws-materials.md §6 惯例增设"实测冲突与待决策"小节。
