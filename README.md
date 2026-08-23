# 单词雷达 WordRadar

> 把网页里的英文生词一键提取出来，自动加到「不背单词」生词本。

WordRadar 是一款 **浏览器扩展 + Node CLI 双形态** 的英文词拾取工具。两种形态共享同一份核心提取逻辑（`@word-radar/core`），通过 CSV 文件互通数据。

| 形态                   | 适用场景                                                               | 入口                                                                           |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Chrome / Edge 扩展** | 边读边采：打开英文网页 → 一键提取全文生词 → 自动推送到不背单词生词本   | `packages/extension/dist/`（加载已解压扩展）或 `dist/word-radar-extension.zip` |
| **Node CLI**           | 离线 / 批量：把本地 `.md` / `.txt` 文本清洗成 CSV 词表，或合并多份词表 | `node packages/cli/dist/index.js`（或 `pnpm install -g` 后用 `word-radar`）    |

详细产品形态与架构见 [`docs/spec.md`](./docs/spec.md)。

## 包结构

| 包                      | 角色                                            | 构建                      | 入口            |
| ----------------------- | ----------------------------------------------- | ------------------------- | --------------- |
| `@word-radar/core`      | 共享纯 TypeScript 核心（提取 / 词形还原 / CSV） | tsup → dist               | `dist/index.js` |
| `@word-radar/cli`       | Node CLI：清洗本地文本 / 合并词表               | tsup → dist（含 shebang） | `dist/index.js` |
| `@word-radar/extension` | Chrome/Edge MV3 扩展（主形态）                  | Vite + @crxjs/vite-plugin | `dist/`         |

`extension` 与 `cli` 只通过包名（`@word-radar/core`）消费 core，禁止 `import` `core/src`。

## 安装

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 9
- Chrome 114+ 或 Edge 114+（用于加载扩展）

### 克隆与依赖

```bash
git clone <repo-url> && cd word-radar
pnpm install
```

### 构建全部包

```bash
pnpm -r build
```

构建完成后：

- CLI 产物：`packages/cli/dist/index.js`
- 扩展产物：`packages/extension/dist/`（可直接作为「已解压扩展」加载）

### 打包扩展为 zip

```bash
pnpm package
```

输出 `dist/word-radar-extension.zip`，`manifest.json` 位于 zip 根层级——解压后直接可加载。

## 使用：浏览器扩展（主形态）

### 加载扩展（Chrome）

1. 打开 `chrome://extensions/`。
2. 右上角开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择 `packages/extension/dist` 目录（或把 `dist/word-radar-extension.zip` 解压到任意目录后选择该目录）。
5. 工具栏出现 WordRadar 图标，即加载成功。

### 加载扩展（Edge）

1. 打开 `edge://extensions/`。
2. 左侧开启「开发人员模式」。
3. 点击「加载解压缩的扩展」。
4. 选择 `packages/extension/dist` 目录。
5. 工具栏出现 WordRadar 图标，即加载成功。

### 日常用法

1. **登录不背单词**：浏览器里打开 <https://bbdc.cn/> 并完成登录（扩展复用浏览器里的 HttpOnly cookie，不需要在扩展里再登录）。
2. **打开英文网页**：任意英文文章页（Medium、Wikipedia、技术博客等）。
3. **点击扩展图标**：popup 自动采集当前页正文，显示「本次采集 N 词」；累计 / 待推计数同步刷新。
4. **查看推送进度**：popup 里的推送状态会从「空闲」→「推送中 M/N：当前词」→「推送完成」，同时显示成功 / 已存在 / 失败计数。
5. **验证生词本**：回 <https://bbdc.cn/> 的「我的生词本」页面，能看到逐个出现的词。
6. **未登录 / 推送失败**：popup 会显示「未登录不背单词」并出现「打开不背单词」按钮；推送失败时显示「推送已暂停」，恢复后可点「重试待推」继续。
7. **CSV 互通**：
   - 「导出 CSV」：把扩展词库下载到本地，可交给 CLI 处理或备份。
   - 「导入 CSV」：把 CLI 生成的 CSV 合并进扩展词库（同词 flags 按位 OR，已推的词不会被洗回待推）。

### 点击扩展图标时各按钮说明

| 按钮                | 作用                                                    |
| ------------------- | ------------------------------------------------------- |
| 重新采集            | 对当前标签页重新跑一次正文提取，结果合并入词库          |
| 检查登录            | 调用 `bbdc.cn/api/check-login` 检测当前 cookie 是否有效 |
| 打开不背单词        | 新标签页打开 <https://bbdc.cn/>（仅在未登录时显示）     |
| 重试待推            | 恢复被暂停的推送队列                                    |
| 导出 CSV / 导入 CSV | 词库 ↔ 本地 CSV 文件                                    |

## 使用：CLI（辅形态）

CLI 是独立可执行脚本，不依赖浏览器，也不需要不背单词账号。

### 直接运行（无需全局安装）

```bash
# 单文件 → 同目录生成 <file>.words.csv
node packages/cli/dist/index.js extract path/to/article.md

# 目录 → 递归处理所有 .md / .txt
node packages/cli/dist/index.js extract path/to/dir

# 指定输出路径（仅单文件）
node packages/cli/dist/index.js extract article.txt -o clean.csv
```

### 全局安装（可选）

```bash
pnpm install -g packages/cli
word-radar extract article.md
word-radar merge a.csv b.csv -o merged.csv
```

### 命令一览

| 命令                                  | 作用                               | 输出                               |
| ------------------------------------- | ---------------------------------- | ---------------------------------- |
| `word-radar extract <file>`           | 单个文件 → CSV 词表                | `<file>.words.csv`（或 `-o` 指定） |
| `word-radar extract <dir>`            | 目录递归处理 `.md` / `.txt`        | 每个文件生成一份 `.words.csv`      |
| `word-radar merge <a.csv> <b.csv>...` | 合并多份词表（同词 flags 按位 OR） | 默认打印到 stdout；`-o` 写文件     |

### 与扩展互通

CLI 生成的 CSV 可以直接在扩展 popup 里「导入 CSV」合并进词库，然后走推送流程到不背单词；扩展「导出 CSV」得到的文件也可以用 `word-radar merge` 与其他词表汇总。

CSV 格式（每行一条）：

```
lemma,flags
serendipity,0
run,1
```

- `lemma`：词形还原后的基本形（`running` / `runs` / `ran` → `run`）。
- `flags`：十进制位掩码。`bit0=1` 表示不背单词已成功推送；`0` 表示待推。导入时已推的词不会被洗回待推。

## 隐私与权限

### 隐私承诺

- **不读取、不转发、不上传你的不背单词 cookie**。扩展只在浏览器内以 `credentials: "include"` 方式向 `bbdc.cn` / `langeasy.com.cn` 发你需要的请求，cookie 由浏览器原生附带，扩展代码从不读取也不存储 cookie 值。
- **零后端**：没有远程服务器、没有账号体系、没有数据收集。所有数据（词库、设置）只存在你浏览器的 IndexedDB 和 `chrome.storage.local` 里。
- **无遥测**：不上报错误、不上报使用行为。

### 权限最小化说明

扩展 `manifest.json` 仅申请以下权限，无一多余：

| 权限                                          | 用途                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                                     | 用 `chrome.storage.local` 保存用户设置（如是否启用自动推送）。                                                                                                                                               |
| `activeTab` + `scripting`                     | 扩展（重）加载后已打开的旧标签页没有 content script，点采集时用 `chrome.scripting.executeScript` 补注入一次再重试。`activeTab` 只作用于你当前点开的标签页（打开 popup 即视为授权），不新增任何网站访问权限。 |
| `contextMenus`                                | 右键扩展图标时显示「采集目标」菜单（如「上传文件」，issue #24）。这是本功能的最小权限，不涉及任何网站访问。                                                                                                                                              |
| `host_permissions: https://bbdc.cn/*`         | 向不背单词主站发 API 请求（登录检查 / 查词 / 加词 / 删词 / 列表）。                                                                                                                                          |
| `host_permissions: https://langeasy.com.cn/*` | 向蓝易主站请求单词释义接口（加词前必须先查释义）。                                                                                                                                                           |

**未申请的权限**：

- `cookies`：扩展不需要读 cookie，浏览器会自动附带 HttpOnly cookie 给 `host_permissions` 里的域名。
- `notifications`：第一版不使用系统通知（登录引导通过 badge + popup 完成）。
- `<all_urls>` host：没有申请——content script 通过 `matches: ["<all_urls>"]` 在所有页面注入，但不需要 host_permission 也能工作（content script 的注入权限与 host_permission 解耦）。

### 支持采集的页面

- **普通网页**：整页采集 + 划词（选中一段文本后点采集，只采选区内的词）。
- **纯文本页**（如 [raw.githubusercontent.com](https://raw.githubusercontent.com) 的 `.md`/`.txt` 直链）：正文整体在 `<pre>` 里也能整页采集、也能划词采集。

## 常见问题

### 提示「此页面无法采集：请刷新页面后重试」

通常是浏览器特殊页面（`chrome://` 设置页、Chrome 商店页等）——这些页面浏览器禁止任何扩展注入脚本，属正常限制。

如果是普通网页也报这个错：多发生在「扩展刚安装 / 刚更新 / 开发模式重载」之后——已打开的旧标签页上还没有采集脚本。扩展会自动尝试补注入；个别情况仍失败时，刷新该页面再点采集即可。

### 点击「检查登录」显示「未登录不背单词」怎么办？

扩展复用你在浏览器里不背单词的登录状态。请：

1. 在浏览器里打开 <https://bbdc.cn/>，正常登录（或重新登录一次）。
2. 回到扩展 popup，点「检查登录」直到显示「已登录不背单词」。
3. 再点「重试待推」继续推送。

### 推送中途中断 / 显示「推送已暂停」

可能原因：不背单词 cookie 过期、网络抖动、4xx 拒绝。处理：

1. 看 popup 推送状态：「推送已暂停：<原因>」。
2. 如果是登录失效：先在浏览器里重新登录 <https://bbdc.cn/>，再点「重试待推」。
3. 如果是网络问题：恢复网络后直接点「重试待推」——失败的词会保留在队列里，不会丢。
4. 推送协调器单请求最多重试 3 次（0 / 800ms / 2000ms），4xx 立即失败但不丢词。

### 同一个词会被重复加到生词本吗？

不会。推送流程里对每个词先调「查重」接口，已存在的词算作「已存在」计数，不会重复添加。同一页面再次采集也是同样行为：重复词不会新增。

### CLI 能直接把词加到不背单词吗？

不能——CLI 拿不到浏览器里的不背单词 cookie。CLI 只负责文本清洗与词表合并；要推到不背单词，把 CSV 通过扩展 popup 的「导入 CSV」按钮导入，由扩展负责推送。

### 扩展支持 Firefox 吗？

第一版仅支持 Chrome 与 Edge（两者同为 Chromium 内核，共享 MV3 扩展格式）。Firefox 暂不支持。

## 开发

```bash
pnpm install
pnpm -r build
pnpm -r test        # 全仓单测（core + cli + extension）
pnpm -r typecheck   # TypeScript 类型检查
pnpm package        # 打扩展 zip
pnpm clean          # 清理所有构建产物
```

扩展开发模式：

```bash
cd packages/extension
pnpm dev   # vite watch 模式，文件改动自动重构建
```

手工验收清单见 [`docs/manual-checklist.md`](./docs/manual-checklist.md)。
