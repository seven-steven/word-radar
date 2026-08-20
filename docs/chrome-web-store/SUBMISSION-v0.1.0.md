# SUBMISSION-v0.1.0 — Chrome Web Store 提交手册

- 版本：`0.1.0`（根 package.json / src manifest / zip 三方一致，verify:manifest ✓）
- 上传包：`dist/word-radar-0.1.0-chrome.zip`（verify:zip ✓）
- 事实基线：[FACTS.md](./FACTS.md)（verify:claims ✓）
- 截图：[screenshots/](./screenshots/) 01–03，1280×800
- Release：https://github.com/seven-steven/word-radar/releases/tag/v0.1.0

## Dashboard 逐项操作

### 1. 上传新版本

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → WordRadar → 新版本 → 上传。
2. 选择本地文件 `dist/word-radar-0.1.0-chrome.zip`。
3. 等待构建状态变为 "ready"。

### 2. Store listing（默认语言：zh 简体中文，本项目唯一语言集）

| Dashboard 字段             | 复制来源                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| 名称                       | WordRadar（单词雷达）                                                                 |
| 简短描述                   | [STORE-LISTING.md](./STORE-LISTING.md)「简短描述」text 块                             |
| 详细描述                   | [STORE-LISTING.md](./STORE-LISTING.md)「详细描述」text 块                             |
| 类别                       | [STORE-LISTING.md](./STORE-LISTING.md)「类别」＝效率工具（Productivity Tools）        |
| 图标 128×128               | `packages/extension/src/icons/icon-128.png`                                           |
| 截图（3 张，1280×800）     | `screenshots/01-reading.png`、`screenshots/02-collect.png`、`screenshots/03-push.png` |
| Homepage URL / Support URL | `https://github.com/seven-steven/word-radar`                                          |

### 3. Privacy

| 字段                         | 来源                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Privacy policy URL           | `https://github.com/seven-steven/word-radar/blob/v0.1.0/docs/chrome-web-store/PRIVACY.md`                                 |
| Single purpose               | [STORE-LISTING.md](./STORE-LISTING.md)「单一用途描述」text 块                                                             |
| 权限理由（逐条，5 个 token） | [STORE-LISTING.md](./STORE-LISTING.md)「权限理由」text 块（storage / activeTab / scripting / bbdc.cn / langeasy.com.cn）  |
| Data usage 勾选              | [STORE-LISTING.md](./STORE-LISTING.md)「隐私做法标签」text 块（勾 Website content、Authentication credentials；其余不勾） |

### 4. 测试账号

- 位置：Dashboard「Account access / 测试账号」栏——**仅填 Dashboard，不入仓库**（FACTS.md §6）。
- 内容：【此处填写】bbdc 测试账号 + 登录方式。绝不写入仓库任何文件。
- 配套测试说明：[STORE-LISTING.md](./STORE-LISTING.md)「测试说明」text 块（两段式：第一段免登录复现采集，第二段验证推送）。

### 5. 提交前最终 verify 清单

- [ ] `pnpm verify:manifest` / `verify:zip` / `verify:claims` / `verify:changelog` 全绿
- [ ] `pnpm test` / `pnpm e2e` 全绿
- [ ] 上传的 zip 即 `dist/word-radar-0.1.0-chrome.zip`（dist/ 唯一版本化 zip）
- [ ] Dashboard 每个字段已按上表来源粘贴（文案直接复制 STORE-LISTING text 块，不改写）
- [ ] 测试账号已填（Dashboard 内）
- [ ] 隐私做法标签勾选与 STORE-LISTING 口径一致；未勾"出售/无关用途/信用评估"

### 6. 提交审核

- 点 Submit for review；记录提交时间与预计审核时长。
- 若被拒：先回 FACTS.md 核对事实层，再改文案层，重新走 `.claude/skills/chrome-extension-release` 发版流程。
