---
name: chrome-extension-release
description: 编排一次 word-radar 的 Chrome Web Store 完整发版：前置检查→版本确认→build/package/verify→材料 freshness→tag/GitHub Release→SUBMISSION 手册→人工提交步骤清单。触发词：发版、上架、release、chrome web store、提交商店。
---

# Chrome Extension 发版编排

本 skill 只做**编排与判断**：所有原子动作都是仓库已有 pnpm scripts 或 git/gh 命令，不在这里隐藏任何逻辑。

## 流程

### 1. 前置检查

```bash
git status --short                 # 必须干净（无未提交变更）
pnpm test                          # 全绿
pnpm typecheck                     # 全绿（如脚本存在）
```

任一不满足 → 停止，报告，不继续。

### 2. 版本确认

- 版本号唯一来源：根 `package.json` 的 `version`。
- 新版本：同步 bump 根 `package.json` 与 `packages/extension/src/manifest.json` 的 `version`，并在 `CHANGELOG.md` 顶部新增 `## [<version>] - YYYY-MM-DD` 条目。
- 已发版本复跑（同版本号重打）：版本号不动，把新变更合并进 CHANGELOG 既有 `## [<version>]` 条目；后续步骤 6 走「重打」分支。
- `pnpm verify:changelog` 应绿。

### 3. 构建、打包、验证全链

```bash
pnpm build && pnpm package
pnpm verify:manifest
pnpm verify:zip
```

产物：`dist/word-radar-<version>-chrome.zip`（唯一版本化 zip，manifest 在 zip 根）。

### 4. 材料 freshness

```bash
pnpm verify:claims                 # 文案层 vs FACTS vs 生产 manifest 一致性
pnpm screenshot                    # 重新生成 docs/chrome-web-store/screenshots/（1280×800）
```

前置：screenshot / e2e 依赖 Playwright 浏览器二进制，缺失时在 `packages/extension` 下跑 `pnpm exec playwright install chromium`。

若 manifest 权限/数据流向有变：先改 `docs/chrome-web-store/FACTS.md`，再改文案层（STORE-LISTING / PRIVACY），再跑 `pnpm verify:claims`。

### 5. 终验

```bash
pnpm test && pnpm e2e              # 全绿才可继续
```

### 6. 提交、tag、GitHub Release

```bash
git add -A && git commit            # 版本相关变更
git push origin main
git tag v<version>
git push origin v<version>
gh release create v<version> dist/word-radar-<version>-chrome.zip \
  --title "v<version>" \
  --notes-file <(awk '/^## \[/{n++} n==1' CHANGELOG.md)
```

notes 提取用 `awk`（截取该版本条目到下一个 `## ` 前）；**不要用 `head -n -1`**（BSD head 不支持负数行数）。

重打分支（版本号未变、tag 已存在）：`git commit --amend` 并入原提交 → `git push origin main` → `git tag -f v<version> && git push -f origin v<version>` → `gh release delete v<version> --yes` 后重新 `gh release create`（旧 zip 作废，上传新 zip）。

gh 认证失败 → 报告并跳过，不伪造结果。

### 7. SUBMISSION 手册

按 [references/submission-template.md](references/submission-template.md) 生成/更新 `docs/chrome-web-store/SUBMISSION-v<version>.md`，并随版本变更一并 commit。

### 8. 提交后人工步骤（告知用户）

在 Chrome Web Store Developer Dashboard 按SUBMISSION 手册逐项复制：

1. 上传 zip（文件包 tab）→ 2. 商品详情文案（STORE-LISTING 各 text 块；标题/摘要自动取自 manifest，不手填）→ 3. 隐私权 tab：单一用途 / 权限理由（**4 框，host 合并一框**）/ 远程代码选「否」/ 数据使用 9 类勾选 / PRIVACY.md 的 GitHub blob URL → 4. 测试说明（独立页 `/testcredentials`，仅填 Dashboard，不入仓库）→ 5. 提交审核。
   Dashboard 字段结构（5 tab + 2 独立页）与上限实测见 [references/cws-materials.md](references/cws-materials.md)；
   权限口径见 [references/permission-justification.md](references/permission-justification.md)；
   完整实测报告见 `docs/chrome-web-store/research-cws-dashboard-fields.md`。
