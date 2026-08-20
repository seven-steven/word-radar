# FACTS.md — 上架事实层

> 本文件是 WordRadar 上架 Chrome Web Store 的**事实基线**。STORE-LISTING.md 与 PRIVACY.md 的每一句对外声明都必须能在本文件（或其引用的仓库文件）里找到依据。`pnpm verify:claims` 断言文案层与生产 manifest、禁词表的一致性。
>
> 维护规则：生产 `packages/extension/src/manifest.json` 的权限、数据流向、产物命名任一变化，先改本文件，再改文案层。

## 1. 生产 manifest 权限逐条理由

来源：`packages/extension/src/manifest.json`（#14 activeTab 瘦身后定稿，无 `content_scripts`、无 `<all_urls>`）。

| 权限 token                  | 理由（可对审核复述）                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                   | `chrome.storage.local` 保存用户设置（如是否启用自动推送）。词库本体在 IndexedDB（无需权限）。                                                              |
| `activeTab`                 | 只作用于用户当前点开扩展 popup 的标签页；配合 `scripting` 在扩展（重）加载后对未注入 content script 的旧标签页补注入一次。不授予任何持续性的网站访问权限。 |
| `scripting`                 | `chrome.scripting.executeScript` 补注入采集脚本（见上）。                                                                                                  |
| `https://bbdc.cn/*`         | 向不背单词主站发 API 请求：登录检查 / 查词 / 加词 / 删词 / 生词本列表。cookie 由浏览器原生附带，扩展代码不读 cookie 值。                                   |
| `https://langeasy.com.cn/*` | 向蓝易主站请求单词释义接口（加词前必须先查释义）。                                                                                                         |

未申请：`cookies`、`notifications`、`tabs`、`<all_urls>` host 权限、`content_scripts`（MV3 下按需注入，#14 已移除声明式注入）。

## 2. 隐私口径与禁词表

**数据流向事实**（PRIVACY.md 必须如实覆盖）：

- 采集仅在用户点击扩展 popup 后处理**当前活动标签页**的正文/选区文本，在浏览器本地完成提取与词形还原。
- 生词在用户授权（点击推送）后逐个发送至 `bbdc.cn`（生词本 API）；加词前查释义请求 `langeasy.com.cn`。
- 鉴权复用浏览器对 `bbdc.cn` 的 HttpOnly cookie；扩展代码不读取、不存储 cookie 值。
- 词库与设置仅存本地（IndexedDB + `chrome.storage.local`）；无后端、无遥测、无第三方分析、无广告 SDK、无远程代码。
- 卸载扩展即清空全部本地数据。

**禁词表**（不可辩护的绝对化声明，出现即违规；唯一执行来源是 `scripts/verify-claims.mjs` 的 `FORBIDDEN_CLAIMS` 正则常量，改表须同步）：

- `不(会)?上传任何(用户)?(数据|信息)` — 假：生词确实发送 bbdc.cn。
- `不(会)?收集任何(用户)?(数据|信息)` / `不(会)?发送任何(用户)?数据` / `不向任何(第三方)?服务器发送` — 假：同上。
- `完全不上传` — 假。
- `无需任何权限` — 假：manifest 声明了 5 个权限 token。

可用的正确表述：「其余数据仅存储在你的浏览器本地」「除推送生词到 bbdc.cn 外不发送任何数据到其他服务器」。

## 3. 产物命名模式

- 打包命令：`pnpm build && pnpm package` → `dist/word-radar-<version>-chrome.zip`（仓库根 `dist/`，manifest 位于 zip 根层级；打包前自动清理旧版本 zip）。
- 版本号唯一来源：根 `package.json` 的 `version`（当前 0.1.0）；`pnpm verify:manifest` 断言 package.json / src manifest / dist manifest 三方一致，`pnpm verify:zip` 断言 zip 结构（唯一版本化 zip、manifest 在根、三尺寸图标、无 .map）。

## 4. 语言集

- Listing 语言集 = **zh（简体中文）**。扩展 UI、README、文档均为中文。

## 5. bbdc / langeasy 平台事实

- 不背单词（bbdc.cn）：第三方背单词服务；生词本 API `/api/user-new-word`，cookie 鉴权，`newwordlist` 须为 JSON 对象（非数组，v1.2.1 官方插件逆向确认）。
- 蓝易（langeasy.com.cn）：不背单词加词前的释义查询接口所在域。
- 本项目与 bbdc.cn / langeasy.com.cn 无隶属关系（listing 需声明"不隶属于相关服务方"口径，具体措辞待人工确认商店审核偏好）。

## 6. 仓库与链接事实

- GitHub 仓库：`https://github.com/seven-steven/word-radar`（issue / 支持入口）。
- 文档：README.md、docs/spec.md、docs/manual-checklist.md。
- 测试账号：Chrome Web Store 审核用的 bbdc 测试账号**仅填写在 Developer Dashboard，不入仓库**（本仓库任何文件不得出现账号/密码）。

## 7. Dashboard 待人工确认项

- 简短描述 132 字符上限、详细描述约 16,000 字符上限、截图建议 1280×800（至少 1 张，至多 5 张）——以提交时 Dashboard 实际表单限制为准。
- 类别：效率工具（Productivity Tools）。
- 隐私做法标签（Data usage）勾选项：Website content（采集网页内容）、Authentication credentials（使用 bbdc cookie 鉴权）；不勾 Website history / Personal communications / Health / Financial 等；不勾 " sold or used for unrelated purposes / credit purposes "。
