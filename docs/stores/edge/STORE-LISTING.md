# STORE-LISTING.md — Edge Add-ons 上架文案（唯一来源）

> 所有 Partner Center 文案以本文件的 ```text 块为唯一来源，直接复制粘贴。
> 事实依据见 [FACTS.md](../FACTS.md)；一致性由 `pnpm verify:claims` 断言（权限 token 覆盖 + 共享禁词表 + 本文件专属 Chrome 字样检查）。
> 位于 `docs/stores/edge/`（商店材料共享层 `docs/stores/` 之下）：文案与 chrome 版同源自 FACTS，仅保留 Edge 平台差异字段，其余块自包含、不跨文件引用。
>
> **红线**：本文件所有 ```text 块（要粘贴进 Partner Center 的文案）不得出现 "Chrome" 字样——词边界匹配，chromium 内核名与 chrome:// 协议字面量不受限；Edge Add-ons 认证对名称/描述含该字样直接拒审。`pnpm verify:claims` 逐块强制。

## 商店描述 Description（250–10,000 字符，每语言必填）

```text
单词雷达 WordRadar：把网页里的英文生词一键收进「不背单词」生词本。

读英文文章时遇到满屏生词？不用再逐个查词、逐个录入。点一下单词雷达 WordRadar，整页（或选中段落）的英文生词即刻提取完毕，自动加入你的不背单词生词本，直接进入复习流程。

核心流程：
1. 打开任意英文网页（文章、Wiki、技术博客均可）。
2. 点击工具栏 单词雷达 WordRadar 图标。
3. 扩展提取当前页正文英文生词，词形还原去重（running/runs/ran 算作 run）。
4. 生词存入本地词库，并逐个推送到你的「不背单词」生词本。
5. 已在生词本里的词不会重复添加；推送失败的词保留待推状态，可随时重试。

主要功能：
- 一键采集：整页正文或选中段落，自动过滤导航、广告、代码块。
- 词形还原：running / runs / ran 自动折回 run，去重后再入库。
- 推送不背单词：复用你在 bbdc.cn 的浏览器登录状态，无需在扩展内再次登录。
- 本地词库：所有生词存浏览器本地，弹窗内查看累计采集、待推、推送进度。
- CSV 互通：词库可导出 CSV 备份，也可导入 CSV（配合命令行工具批量清洗本地文本）。

隐私：
- 仅在你点击扩展时处理当前标签页内容。
- 除把生词推送至 bbdc.cn（及加词前查询释义的 langeasy.com.cn）外，不向任何其他服务器发送数据。
- 不读取你的 cookie 值；无遥测、无第三方分析、无广告、无远程代码。
- 词库与设置仅存浏览器本地；卸载扩展即全部清除。

详细说明与源码：https://github.com/seven-steven/word-radar
```

（约 640 字符，满足 Edge ≥250 下限、≤10,000 上限。）

## 短描述（来自 manifest，不手填）

Partner Center 从 zip manifest 自动读取短描述（manifest description 由 `_locales` 控制，与 CWS 同源）；改动需重传 zip，不在本文件重复维护。

## Search terms（可选：≤7 条、合计 ≤21 词、单条 ≤30 字符）

```text
生词采集
不背单词
背单词
英文阅读
词汇量
生词本
网页取词
```

（7 条中文短语，单条均 ≤30 字符；提交时以 Partner Center 实际计数器为准。）

## 类别

```text
效率工具
```

（提交时以 Partner Center 类目树实际选项为准。）

## 单一用途描述（Single Purpose）

```text
从用户当前浏览的网页中提取英文生词，并推送到用户的「不背单词」生词本。
```

## 权限理由（逐条，与生产 manifest 一一对应）

```text
storage — 在浏览器本地保存扩展设置（如是否启用自动推送）。词库存储在浏览器 IndexedDB 中，无需额外权限。

activeTab — 仅在你点击扩展图标时获得当前标签页的临时访问，用于读取该页文本以提取生词。不授予对任何网站的持续访问权限。

scripting — 扩展更新或重载后，对尚未注入采集脚本的已打开标签页，在你点击采集时补注入一次采集脚本。仅与 activeTab 配合、仅作用于当前标签页。

contextMenus — 右键点击浏览器工具栏中的扩展图标时，显示「采集当前页」「上传文件采集生词」两个快捷入口，点击仅打开扩展弹窗。不占用网页内的右键菜单，也不借此读取任何页面内容。

https://bbdc.cn/* — 将采集到的生词加入你的「不背单词」生词本（登录检查 / 查词 / 加词 / 生词本列表均请求该域）。登录状态复用你浏览器中 bbdc.cn 的 cookie，扩展不读取 cookie 值。

https://langeasy.com.cn/* — 加入生词本前，通过该域的接口查询单词释义（不背单词加词接口的必需前置步骤）。
```

## 隐私做法与数据使用声明

```text
勾选：
- 网站内容（Website content）：仅用户点击扩展时读取当前标签页文本，提取英文生词；不在后台浏览历史。
- 身份验证凭据（Authentication credentials）：复用浏览器对 bbdc.cn 的登录 cookie 完成推送；扩展不读取、不存储 cookie 值。

不勾选：
- 网站历史 / 用户活动 / 个人通讯 / 健康 / 财务 / 精确位置 等全部其他项。
- 数据不出售、不用于无关用途、不用于信用评估。
```

（字段名以提交时 Partner Center Privacy 页实际表单为准，待人工确认。）

## 测试说明（分两段）

```text
本扩展分两段测试，第一段无需任何账号即可完整复现核心采集功能。

第一段（免登录可复现）：
1. 安装扩展后，打开任意英文文章页（例如 https://raw.githubusercontent.com/mattpocock/skills/refs/heads/main/skills/productivity/grilling/SKILL.md ）。
2. 点击工具栏 单词雷达 WordRadar 图标打开弹窗（打开不自动采集）。
3. 点弹窗内「采集当前页」按钮采集当前页生词，确认卡显示「本次共计采集 N 个单词，其中新词 M 个」（N ≥ 1）。
4. 点「确认推送」后生词才存入浏览器本地词库（IndexedDB），无需任何账号。

第二段（需不背单词账号）：
1. 在浏览器打开 https://bbdc.cn/ 并登录。
2. 点击 单词雷达 WordRadar 弹窗内「检查登录」，确认显示已登录。
3. 打开英文网页并采集，弹窗显示推送进度（推送中 M/N → 推送完成）。
4. 到 bbdc.cn「我的生词本」页面，确认刚采集的词已出现。

测试账号：将随提交在 Partner Center 的测试说明/认证备注栏填写（含登录方式），不占用本页面。
```

## 支持与官网 URL

```text
https://github.com/seven-steven/word-radar
```

（Homepage / Support 均填此仓库 URL；issue 入口 `https://github.com/seven-steven/word-radar/issues`。）
