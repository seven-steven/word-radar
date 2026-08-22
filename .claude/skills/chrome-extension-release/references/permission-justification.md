# 权限理由与隐私做法口径（平台层）

> 唯一事实来源：`docs/chrome-web-store/FACTS.md` §1–§2 与生产 `packages/extension/src/manifest.json`。本文件只提示写法要点。
>
> 字段结构与 Dashboard 实测口径以 2026-08-22 dump 为准（`docs/chrome-web-store/research-cws-dashboard-fields.md` §3–§4）。

## 1. 宽权限雷区（本项目全部避开）

| 雷区                                    | 本项目做法                                                     |
| --------------------------------------- | -------------------------------------------------------------- |
| `<all_urls>` / 宽 host 权限             | 仅 `https://bbdc.cn/*`、`https://langeasy.com.cn/*` 两个业务域 |
| `content_scripts` 声明式全站注入        | 无声明式注入；#14 起为 activeTab + 按需 `executeScript`        |
| `cookies` 权限                          | 未申请；鉴权复用浏览器原生 HttpOnly cookie，代码不读值         |
| `tabs` / `notifications` / `webRequest` | 未申请                                                         |
| 远程代码                                | 无；全部代码随包分发                                           |

## 2. Dashboard 权限理由输入框结构（**实测**）

Dashboard 隐私权 tab 把权限理由渲染为 **4 个 textarea**（不是 5 个）：

| 输入框                            | 上限      | 对应 manifest token            |
| --------------------------------- | --------- | -------------------------------- |
| 需请求 storage 的理由              | 1,000     | `storage`                        |
| 需请求 activeTab 的理由            | 1,000     | `activeTab`                      |
| 需请求 scripting 的理由            | 1,000     | `scripting`                      |
| 需请求**主机权限**的理由            | 1,000     | `https://bbdc.cn/*` + `https://langeasy.com.cn/*` **合并入同一框** |

> STORE-LISTING.md「权限理由」text 块按 5 条理由写（便于事实追溯与 review），但人工复制到 Dashboard 时需把第 4、5 条（bbdc + langeasy）合并粘贴到"需请求主机权限的理由"框。

## 3. activeTab / scripting 写法要点

- 强调"**仅在用户点击扩展时**获得当前标签页的**临时**访问"，不授予持续性网站访问。
- `scripting` 必须与 activeTab 配对解释：扩展（重）加载后对未注入的旧标签页补注入一次采集脚本，仍仅作用于当前标签页。
- 权限理由逐条对应 manifest token，不可多写也不可漏写（verify:manifest 已断言三方一致）。

## 4. 远程代码声明

| 控件                       | 选项                                       | 本项目选择 |
| -------------------------- | ------------------------------------------ | ---------- |
| 您正在使用远程代码吗？      | `不，我并未使用远程代码` / `是的，我在使用远程代码` | **`不`** |
| 理由                       | 0/1,000（仅"是的"时填写）                  | 留 0 字符  |

> manifest 无 `unsafe-eval`、无外部 `<script>` 引用、无 `eval()`、无 `chrome.runtime.connect` 到任意动态脚本源 — 默认"不"。

## 5. 数据使用勾选（实测 **9 类**）

> 实测 9 个勾选项；本项目**勾 2 项 + 不勾 7 项**。

| Dashboard 标签       | 英文对应                            | 本项目勾选 | 红线（禁词表）                                              |
| -------------------- | ------------------------------------ | ---------- | ----------------------------------------------------------- |
| 个人身份信息         | Personally identifiable information  | 不勾       | 绝不说"不收集任何用户数据"（生词确实发 bbdc.cn）             |
| 健康信息             | Health information                   | 不勾       | —                                                           |
| 财务和付款信息       | Financial and payment information    | 不勾       | —                                                           |
| **身份验证信息**     | Authentication credentials           | **勾**     | 复用浏览器对 bbdc.cn 的 cookie 鉴权；扩展不读 cookie 值     |
| 个人通讯             | Personal communications              | 不勾       | —                                                           |
| 位置                 | Precise location                     | 不勾       | —                                                           |
| 网络记录             | Website history                      | 不勾       | —                                                           |
| 用户活动             | User activity                        | 不勾       | —                                                           |
| **网站内容**         | Website content                      | **勾**     | 仅用户主动触发时读取当前标签页文本                          |

## 6. Limited use 强制确认（**3 条必勾**）

Dashboard 强制三选全勾，否则不能提交：

| # | 文案                                                                      | 必勾 |
| - | -------------------------------------------------------------------------- | ---- |
| 1 | 我不会出于已获批准的用途之外的用途向第三方**出售或传输**用户数据            | ✓   |
| 2 | 我不会为实现与我的产品的**单一用途无关的目的**而使用或转移用户数据          | ✓   |
| 3 | 我不会为**确定信用度或实现贷款**而使用或转移用户数据                        | ✓   |

## 7. 隐私权政策网址

- **必填**（标 `*`），≤ 2,048 字符。
- 来源：`https://github.com/seven-steven/word-radar/blob/v<version>/docs/chrome-web-store/PRIVACY.md`。

## 8. 测试说明（独立页，URL `/testcredentials`）

> 注意：**不是 "Account access" tab**——实测命名是 sidebar 独立页"测试说明"。

| 字段     | 上限      | 内容（**绝不入仓库**）                                                |
| -------- | --------- | ------------------------------------------------------------------- |
| 用户名    | 100 字符  | bbdc 测试账号用户名                                                   |
| 密码      | 100 字符  | bbdc 测试账号密码                                                     |
| 其他说明  | 500 字符  | STORE-LISTING「测试说明」text 块（两段式）                            |

## 9. 表述红线（禁词表，`scripts/verify-claims.mjs` 强制）

不说"不上传/不收集任何数据"这类绝对化措辞——生词确实发送 bbdc.cn。
正确口径：
- "除推送生词到 bbdc.cn 外不发送任何数据到其他服务器"
- "其余数据仅存本地"
- "不读取 cookie 值"（区别于"不使用 cookie"）

## 10. 与 FACTS / STORE-LISTING / PRIVACY 的接口

- 权限理由的**事实依据**（5 条理由各自引用到的代码位置）：FACTS.md §1。
- 权限理由的**文案层**（对外声明）：STORE-LISTING.md「权限理由」text 块。
- 隐私做法的**对外声明**：PRIVACY.md + STORE-LISTING.md「隐私做法标签」text 块。
- 字段结构 / 字数上限 / 必填项的**Dashboard 实测**：本文 §2–§8 + research-cws-dashboard-fields.md。