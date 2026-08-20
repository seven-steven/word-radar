# STORE-LISTING.md — Chrome Web Store 上架文案（唯一来源）

> 所有 Dashboard 文案以本文件的 ```text 块为唯一来源，直接复制粘贴。
事实依据见 [FACTS.md](./FACTS.md)；一致性由 `pnpm verify:claims`断言。
位于`docs/chrome-web-store/`（而非仓库根）：与 FACTS/PRIVACY 同层，避免根目录再增散文件，且文案层三者互相引用。

## 简短描述（≤132 字符）

```text
一键提取网页英文生词，词形还原去重，自动加入「不背单词」生词本。数据存本地，CSV 可导出。
```

（56 字符，含标点；上限 132，待提交时以 Dashboard 实际限制为准。）

## 详细描述

```text
WordRadar（单词雷达）：把网页里的英文生词一键收进「不背单词」生词本。

读英文文章时遇到满屏生词？不用再逐个查词、逐个录入。点一下 WordRadar，整页（或选中段落）的英文生词即刻提取完毕，自动加入你的不背单词生词本，直接进入复习流程。

核心流程：
1. 打开任意英文网页（文章、Wiki、技术博客均可）。
2. 点击工具栏 WordRadar 图标。
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

## 类别

```text
效率工具
```

（Productivity Tools；待提交时以 Dashboard 类目实际选项为准。）

## 单一用途描述（Single Purpose）

```text
从用户当前浏览的网页中提取英文生词，并推送到用户的「不背单词」生词本。
```

## 权限理由（逐条，与生产 manifest 一一对应）

```text
storage — 在浏览器本地保存扩展设置（如是否启用自动推送）。词库存储在浏览器 IndexedDB 中，无需额外权限。

activeTab — 仅在你点击扩展图标时获得当前标签页的临时访问，用于读取该页文本以提取生词。不授予对任何网站的持续访问权限。

scripting — 扩展更新或重载后，对尚未注入采集脚本的已打开标签页，在你点击采集时补注入一次采集脚本。仅与 activeTab 配合、仅作用于当前标签页。

https://bbdc.cn/* — 将采集到的生词加入你的「不背单词」生词本（登录检查 / 查词 / 加词 / 生词本列表均请求该域）。登录状态复用你浏览器中 bbdc.cn 的 cookie，扩展不读取 cookie 值。

https://langeasy.com.cn/* — 加入生词本前，通过该域的接口查询单词释义（不背单词加词接口的必需前置步骤）。
```

## 隐私做法标签（Data Usage，Dashboard 勾选项口径）

```text
勾选：
- Website content（网站内容）：仅用户点击扩展时读取当前标签页文本，提取英文生词；不在后台浏览历史。
- Authentication credentials（身份验证凭据）：复用浏览器对 bbdc.cn 的登录 cookie 完成推送；扩展不读取、不存储 cookie 值。

不勾选：
- Website history / User activity / Personal communications / Health / Financial / Precise location 等全部其他项。
- 数据不出售、不用于无关用途、不用于信用评估。
```

（字段名以提交时 Dashboard 实际表单为准，待人工确认。）

## 测试说明（分两段）

```text
本扩展分两段测试，第一段无需任何账号即可完整复现核心采集功能。

第一段（免登录可复现）：
1. 安装扩展后，打开任意英文文章页（例如 https://en.wikipedia.org/wiki/Word ）。
2. 点击工具栏 WordRadar 图标打开弹窗。
3. 弹窗自动采集当前页生词，显示「本次采集 N 词」（N ≥ 1），「累计采集」计数递增。
4. 生词此时已存入浏览器本地词库（IndexedDB），无需任何账号。

第二段（需不背单词账号）：
1. 在浏览器打开 https://bbdc.cn/ 并登录。
2. 点击 WordRadar 弹窗内「检查登录」，确认显示已登录。
3. 打开英文网页并采集，弹窗显示推送进度（推送中 M/N → 推送完成）。
4. 到 bbdc.cn「我的生词本」页面，确认刚采集的词已出现。

测试账号：将随提交在 Developer Dashboard 的测试账号栏填写（含登录方式），不占用本页面。
```

## 支持与官网 URL

```text
https://github.com/seven-steven/word-radar
```

（Homepage / Support / 加入页面均填此仓库 URL；issue 入口 `https://github.com/seven-steven/word-radar/issues`。）
