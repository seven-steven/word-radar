---
name: extension-release
description: 编排一次 word-radar 的双商店（Chrome Web Store + Edge Add-ons）完整发版：前置检查→版本确认→build/package/verify→双商店材料 freshness→双浏览器终验→tag/GitHub Release→两商店 SUBMISSION 手册→商店提交（网页或 API）。触发词：发版、上架、release、chrome web store、edge addons、提交商店。
---

# 扩展双商店发版编排（Chrome Web Store + Edge Add-ons）

本 skill 只做**编排与判断**：所有原子动作都是仓库已有 pnpm scripts 或 git/gh 命令，不在这里隐藏任何逻辑。

双商店模型（ADR 0004）：

- **同一份产物**：`dist/word-radar-<version>.zip`，两商店共用（Chromium MV3 代码级兼容，无商店变体）。
- **共享事实源**：`docs/stores/FACTS.md` / `PRIVACY.md` / `screenshots/`（两商店同源）；上架文案按商店分家（`docs/stores/chrome/`、`docs/stores/edge/` 各自 STORE-LISTING + SUBMISSION 手册）。
- **提交同步**：每次发版两商店都提交。Edge 审核最长 7 个工作日、通过即自动上线（无法控制时机）——Edge 上线天然滞后、两商店版本短暂不一致，属预期，不视为事故。

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

产物：`dist/word-radar-<version>.zip`（唯一版本化 zip，manifest 在 zip 根；两商店共用）。

### 4. 材料 freshness（双商店）

```bash
pnpm verify:claims                 # 两商店 listing + 共享 PRIVACY vs FACTS 一致性 + Edge listing Chrome 字样禁令
pnpm screenshot                    # 重新生成 docs/stores/screenshots/（1280×800，两商店共用尺寸）
```

前置：screenshot / e2e 依赖 Playwright 浏览器二进制，缺失时在 `packages/extension` 下跑 `pnpm exec playwright install chromium`；Edge 通道另需系统安装 Edge（`--channel msedge`）。

若 manifest 权限/数据流向有变：先改 `docs/stores/FACTS.md`，再同步改文案层（**两边 STORE-LISTING** + PRIVACY——权限理由块逐 token 对齐 manifest，`verify:claims` 双向断言），再跑 `pnpm verify:claims`。

### 5. 终验（双浏览器）

```bash
pnpm test && pnpm e2e                                        # chromium 全量
pnpm e2e --no-build --channel msedge -- smoke collect push active-tab-inject popup   # Edge 核心子集
```

Edge 通道复用 e2e 基建（`E2E_CHANNEL` 三层已消费），位置参数为 spec 文件名子串过滤。upload-canvas / raw-* / opfs / screenshot 留 chromium 全量。`action.openPopup`（右键菜单路径）不在 e2e 覆盖内——Edge 侧靠 `docs/manual-checklist.md` §3 人工走查。Edge 未安装或通道失败 → 报告并停止，不静默跳过。

### 6. 提交、tag、GitHub Release

```bash
git add -A && git commit            # 版本相关变更
git push origin main
git tag v<version>
git push origin v<version>
gh release create v<version> dist/word-radar-<version>.zip \
  --title "v<version>" \
  --notes-file <(awk '/^## \[/{n++} n==1' CHANGELOG.md)
```

notes 提取用 `awk`（截取该版本条目到下一个 `## ` 前）；**不要用 `head -n -1`**（BSD head 不支持负数行数）。

重打分支（版本号未变、tag 已存在）：`git commit --amend` 并入原提交 → `git push origin main` → `git tag -f v<version> && git push -f origin v<version>` → `gh release delete v<version> --yes` 后重新 `gh release create`（旧 zip 作废，上传新 zip）。

gh 认证失败 → 报告并跳过，不伪造结果。

### 7. SUBMISSION 手册（两商店）

- CWS：按 [references/cws-submission-template.md](references/cws-submission-template.md) 生成/更新 `docs/stores/chrome/SUBMISSION-v<version>.md`。
- Edge：按 [references/edge-submission-template.md](references/edge-submission-template.md) 生成/更新 `docs/stores/edge/SUBMISSION-v<version>.md`。

均随版本变更一并 commit。

### 8. 商店提交（两商店，按通道分流）

**首发（两商店均无 API 可用）**：人工按各 SUBMISSION 手册逐项操作（CWS Dashboard / Edge Partner Center 网页）。

**版本更新、已配置 API 凭证（1.2.0 起的常态）**：

标识符来源：`CWS_PUBLISHER_ID` / `CWS_ITEM_ID` 取自 CWS Developer Dashboard 的 devconsole URL（`.../devconsole/{publisherId}/{itemId}/...`，亦即扩展 ID）；`EDGE_PRODUCT_ID` 取自 Partner Center 扩展 overview 页的 Extension identity 区（Product ID）。

```bash
# —— Edge Add-ons Update API v1.1（凭证：EDGE_ADDONS_CLIENT_ID / EDGE_ADDONS_API_KEY 环境变量，绝不入库）——
# ① 传包 → 202 + Location 头含 operationID
curl -sS -X POST "https://api.addons.microsoftedge.microsoft.com/v1/products/$EDGE_PRODUCT_ID/submissions/draft/package" \
  -H "Authorization: ApiKey $EDGE_ADDONS_API_KEY" -H "X-ClientID: $EDGE_ADDONS_CLIENT_ID" \
  -H "Content-Type: application/zip" --data-binary @dist/word-radar-<version>.zip
# ② 轮询传包状态至 status=Succeeded（InProgress/Failed；失败看 errorCode）
curl -sS "https://api.addons.microsoftedge.microsoft.com/v1/products/$EDGE_PRODUCT_ID/submissions/draft/package/operations/<operationID>" \
  -H "Authorization: ApiKey $EDGE_ADDONS_API_KEY" -H "X-ClientID: $EDGE_ADDONS_CLIENT_ID"
# ③ 发布（body 带 notes for certification）→ 用 submissions/operations/<operationID> 轮询至 Succeeded
curl -sS -X POST "https://api.addons.microsoftedge.microsoft.com/v1/products/$EDGE_PRODUCT_ID/submissions" \
  -H "Authorization: ApiKey $EDGE_ADDONS_API_KEY" -H "X-ClientID: $EDGE_ADDONS_CLIENT_ID" \
  -H "Content-Type: application/json" -d '{"notes":"<认证备注，可引 STORE-LISTING 测试说明块>"}'

# —— Chrome Web Store API V2（service account impersonation；token 约 1 小时有效，用前现取）——
gcloud auth print-access-token --impersonate-service-account="$CWS_SA_EMAIL" \
  --scopes="https://www.googleapis.com/auth/chromewebstore" > /tmp/cws.token
# ① 上传 zip（POST + -T；uploadState=UPLOAD_IN_PROGRESS 时需轮询 :fetchStatus）
curl -sS -X POST -T dist/word-radar-<version>.zip \
  "https://chromewebstore.googleapis.com/upload/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_ITEM_ID:upload" \
  -H "Authorization: Bearer $(cat /tmp/cws.token)"
# ② 发布（V2 body：publishType=DEFAULT_PUBLISH；不用 v1.1 的 trustedTesters 查询参数）
curl -sS -X POST "https://chromewebstore.googleapis.com/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_ITEM_ID:publish" \
  -H "Authorization: Bearer $(cat /tmp/cws.token)" -H "Content-Type: application/json" -d '{}'
# ③ 查上传/发布状态（publishedItemRevisionStatus / lastAsyncUploadState）
curl -sS "https://chromewebstore.googleapis.com/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_ITEM_ID:fetchStatus" \
  -H "Authorization: Bearer $(cat /tmp/cws.token)"
```

注意：两商店 API 都**只能更新已发布产品、不能改 listing 元数据**——listing / 隐私 tab 有变时仍需网页（参照 SUBMISSION 手册对应小节）。Edge API key 有过期日期（Publish API 页可见 Expiry），过期回该页重新 Create API credentials 续期。凭证未配置 → 走网页，不伪造 API 结果；API 报错 → 报告原始错误并停在当前步骤。

### 9. 提交后人工步骤（告知用户）

- **CWS**：按 `docs/stores/chrome/SUBMISSION-v<version>.md` 逐项：上传 zip → STORE-LISTING 文案（标题/摘要自动取自 manifest，不手填）→ 隐私权 tab（单一用途 / 权限理由 4 框、host 合并一框 / 远程代码「否」/ 数据使用 9 类勾 2 / PRIVACY.md blob URL）→ 测试说明（独立页 `/testcredentials`，仅填 Dashboard）→ 提交审核。字段实测见 [references/cws-materials.md](references/cws-materials.md)。
- **Edge**：按 `docs/stores/edge/SUBMISSION-v<version>.md` 逐项（Partner Center）。字段口径见 [references/edge-materials.md](references/edge-materials.md)——官方文档口径，首次提交后以实测回填。权限理由写法见 [references/permission-justification.md](references/permission-justification.md)（两商店同源，事实依据 FACTS.md §1-2）。
- 若被拒：先回 `docs/stores/FACTS.md` 核对事实层，再改文案层，重新走本 skill。
