# SUBMISSION-v<version> 模板

> 复制本模板到 `docs/chrome-web-store/SUBMISSION-v<version>.md` 并逐项填写。这是 Dashboard 提交当场的操作手册：每一项都写明复制来源或填写位置。

```markdown
# SUBMISSION-v<version> — Chrome Web Store 提交手册

- 版本：`<version>`（根 package.json / src manifest / zip 三方一致，verify:manifest ✓）
- 上传包：`dist/word-radar-<version>-chrome.zip`（verify:zip ✓）
- 事实基线：[FACTS.md](./FACTS.md)（verify:claims ✓）
- 截图：docs/chrome-web-store/screenshots/ 01-03，1280×800
- Release：<GitHub Release URL>

## Dashboard 逐项操作

### 1. 上传新版本

1. Developer Dashboard → WordRadar → 新版本 → 上传。
2. 选择本地文件 `dist/word-radar-<version>-chrome.zip`。
3. 等待 "Status: ready"。

### 2. Store listing（默认语言：zh 简体中文）

| Dashboard 字段             | 复制来源                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| 名称                       | WordRadar（单词雷达）                                                         |
| 简短描述                   | STORE-LISTING「简短描述」text 块                                              |
| 详细描述                   | STORE-LISTING「详细描述」text 块                                              |
| 类别                       | STORE-LISTING「类别」（效率工具）                                             |
| 图标 128×128               | packages/extension/src/icons/icon-128.png                                     |
| 截图（1–5 张，1280×800）   | docs/chrome-web-store/screenshots/01-reading.png、02-collect.png、03-push.png |
| Homepage URL / Support URL | https://github.com/seven-steven/word-radar                                    |

### 3. Privacy

| 字段               | 来源                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Privacy policy URL | https://github.com/seven-steven/word-radar/blob/v<version>/docs/chrome-web-store/PRIVACY.md |
| Single purpose     | STORE-LISTING「单一用途描述」text 块                                                        |
| 权限理由（逐条）   | STORE-LISTING「权限理由」text 块（对应 manifest 5 个 token）                                |
| Data usage 勾选    | STORE-LISTING「隐私做法标签」text 块                                                        |

### 4. 测试账号

- 位置：Dashboard「Account access / 测试账号」栏（仅填 Dashboard，不入仓库）。
- 内容：【此处填写】bbdc 测试账号 + 登录方式（绝不写入仓库任何文件）。
- 配套测试说明：STORE-LISTING「测试说明」text 块（两段式，第一段免登录）。

### 5. 提交前最终 verify 清单

- [ ] verify:manifest / verify:zip / verify:claims / verify:changelog 全绿
- [ ] pnpm test / pnpm e2e 全绿
- [ ] zip 为待上传的同一文件（比对 dist/ 唯一 zip）
- [ ] Dashboard 每个字段已按上表来源粘贴
- [ ] 测试账号已填（Dashboard 内）
- [ ] 隐私做法标签勾选与 STORE-LISTING 口径一致

### 6. 提交审核

- 点 Submit for review；记录提交时间与预计审核时长。
```
