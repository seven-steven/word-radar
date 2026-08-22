# SUBMISSION-v<version> 模板

> 复制本模板到 `docs/chrome-web-store/SUBMISSION-v<version>.md` 并逐项填写。这是 Dashboard 提交当场的操作手册：每一项都写明复制来源或填写位置。
>
> 字段口径以 2026-08-22 Dashboard 实测为准；详细实测 dump 与字段上下限见 [`docs/chrome-web-store/research-cws-dashboard-fields.md`](../../../../docs/chrome-web-store/research-cws-dashboard-fields.md) 与 skill [`references/cws-materials.md`](../cws-materials.md)。

```markdown
# SUBMISSION-v<version> — Chrome Web Store 提交手册

- 版本：`<version>`（根 package.json / src manifest / zip 三方一致，verify:manifest ✓）
- 上传包：`dist/word-radar-<version>-chrome.zip`（verify:zip ✓）
- 事实基线：[FACTS.md](./FACTS.md)（verify:claims ✓）
- 截图：docs/chrome-web-store/screenshots/ 01-03，1280×800
- Release：<GitHub Release URL>

## Dashboard 入口结构（实测）

WordRadar 编辑页 = **5 个 tab**（状态 / 文件包 / 商品详情 / 隐私权 / 分发）+ **2 个左侧 sidebar 独立页**（访问权限 / 测试说明）。
"测试说明"不是 tab，而是 URL `/testcredentials` 的独立页。

## Dashboard 逐项操作

### 1. 上传新版本（文件包 tab）

1. Developer Dashboard → WordRadar → 新版本 → 上传。
2. 选择本地文件 `dist/word-radar-<version>-chrome.zip`。
3. 等待 "Status: ready"。
4. 文件包 tab 自动读取（无需手填）：
   - 版本 = `<version>`
   - 内容类型 = `扩展程序`
   - 权限 = `storage, activeTab, scripting, host permission`
   - CRX 文件 = `main.crx`
   - 公钥 = "查看公钥"链接

### 2. Store listing（商品详情 tab，默认语言：zh 简体中文）

| Dashboard 字段                  | 自动/手填         | 复制来源                                                                              |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| 软件包中的标题                  | **自动**（manifest） | manifest.name = `WordRadar`（**不建议覆盖**）                                       |
| 软件包中的摘要                  | **自动**（manifest） | manifest.description（**不建议覆盖**）                                              |
| 说明                            | 手填，≤16,000       | STORE-LISTING「详细描述」text 块                                                      |
| 类别                            | 手填单选            | STORE-LISTING「类别」text 块（**当前 Dashboard 实测 = 教育**；约定目标 = 效率工具）   |
| 语言                            | 手填单选            | 默认 = `中文（中国）`                                                                  |
| 商店图标 128×128                | 手填                | `packages/extension/src/icons/icon-128.png`                                            |
| 屏幕截图（1–5 张）              | 手填                | `docs/chrome-web-store/screenshots/01-reading.png`、`02-collect.png`、`03-push.png`（**JPEG 或 24 位 PNG（无 alpha）**；1280×800 或 640×400） |
| 小型宣传图块 440×280（可选）     | 手填                | 本项目**不传**                                                                         |
| 顶部宣传图块 1400×560（可选）   | 手填                | 本项目**不传**                                                                         |
| 官方网址                        | 手填，可选          | 本项目**不填**（默认"无"）                                                             |
| 首页网址                        | 手填，≤2,048        | `https://github.com/seven-steven/word-radar`                                          |
| 支持信息页面网址                | 手填，≤2,048        | `https://github.com/seven-steven/word-radar/issues`                                   |
| 成人内容                        | 复选                | **不勾**                                                                                |

### 3. Privacy（隐私权 tab）

| Dashboard 字段             | 上限      | 来源                                                                                                                |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| 单一用途说明               | 1,000     | STORE-LISTING「单一用途描述」text 块                                                                                  |
| 需请求 storage 的理由       | 1,000     | STORE-LISTING「权限理由」text 块第一条                                                                                |
| 需请求 activeTab 的理由     | 1,000     | 第二条                                                                                                                |
| 需请求 scripting 的理由     | 1,000     | 第三条                                                                                                                |
| 需请求**主机权限**的理由    | 1,000     | **第四条 + 第五条**（bbdc.cn + langeasy.com.cn **合并写入同一框**）                                                  |
| 您正在使用远程代码吗？      | 单选      | **不，我并未使用远程代码**（manifest 无外部 `<script>` / 无 `eval()`）                                                |
| 远程代码理由                | 0/1,000   | 留空（仅选"是的"时填写）                                                                                            |
| 数据使用（9 类勾选）         | 多选      | **勾**：身份验证信息、网站内容；**不勾**：个人身份信息 / 健康 / 财务 / 个人通讯 / 位置 / 网络记录 / 用户活动            |
| Limited use 认证勾选（3 条） | 必勾 3 条 | 我不会出售或传输用户数据用于非批准用途；不会为无关目的使用或转移用户数据；不会用于确定信用度或贷款                  |
| 隐私权政策网址*             | 2,048 必填 | `https://github.com/seven-steven/word-radar/blob/v<version>/docs/chrome-web-store/PRIVACY.md`                       |

### 4. Distribution（分发 tab）

| Dashboard 字段       | 选择                          |
| -------------------- | ----------------------------- |
| 付款                  | **免费**                       |
| 公开范围              | **公开**                       |
| 分发地区              | 默认 "所有未列出的地区"（= 全球） |

### 5. 测试说明（**sidebar 独立页**，URL `/testcredentials`）

> **不是 "Account access" tab**——实测为 sidebar 独立页。

| 字段       | 上限     | 内容（绝不写入仓库）                                                                              |
| ---------- | -------- | ----------------------------------------------------------------------------------------------- |
| 用户名      | 100 字符 | 【此处填写】bbdc 测试账号用户名                                                                  |
| 密码        | 100 字符 | 【此处填写】bbdc 测试账号密码                                                                    |
| 其他说明    | 500 字符 | STORE-LISTING「测试说明」text 块（两段式：第一段免登录复现采集；第二段验证推送）                  |

支持多条凭证；本项目建议**只填一条**。

### 6. 提交前最终 verify 清单

- [ ] `pnpm verify:manifest` / `verify:zip` / `verify:claims` / `verify:changelog` 全绿
- [ ] `pnpm test` / `pnpm e2e` 全绿
- [ ] 上传的 zip 即 `dist/word-radar-<version>-chrome.zip`（dist/ 唯一版本化 zip）
- [ ] 商品详情每个字段已按上表来源粘贴（说明字段直接复制 STORE-LISTING「详细描述」text 块，不改写）
- [ ] 隐私权字段已填：4 框权限理由、Remote code 选 No、9 类 Data usage 勾 2 类、Limited use 三勾、隐私政策 URL 必填
- [ ] 测试账号已填（Dashboard 内 sidebar `/testcredentials` 独立页）
- [ ] 隐私做法标签勾选与 STORE-LISTING 口径一致；未勾"出售/无关用途/信用评估"

### 7. 提交审核

1. 点 Submit for review；记录提交时间与预计审核时长。
2. 若被拒：先回 FACTS.md 核对事实层，再改文案层，重新走 `.claude/skills/chrome-extension-release` 发版流程。
```