# 权限理由与隐私做法口径（平台层）

> 唯一事实来源：`docs/chrome-web-store/FACTS.md` §1–§2 与生产 `packages/extension/src/manifest.json`。本文件只提示写法要点。

## 宽权限雷区（本项目全部避开）

| 雷区                                    | 本项目做法                                                     |
| --------------------------------------- | -------------------------------------------------------------- |
| `<all_urls>` / 宽 host 权限             | 仅 `https://bbdc.cn/*`、`https://langeasy.com.cn/*` 两个业务域 |
| `content_scripts` 声明式全站注入        | 无声明式注入；#14 起为 activeTab + 按需 `executeScript`        |
| `cookies` 权限                          | 未申请；鉴权复用浏览器原生 HttpOnly cookie，代码不读值         |
| `tabs` / `notifications` / `webRequest` | 未申请                                                         |
| 远程代码                                | 无；全部代码随包分发                                           |

## activeTab 模式写法要点

- 强调"**仅在用户点击扩展时**获得当前标签页的**临时**访问"，不授予持续性网站访问。
- `scripting` 必须与 activeTab 配对解释：扩展（重）加载后对未注入的旧标签页补注入一次采集脚本，仍仅作用于当前标签页。
- 权限理由逐条对应 manifest token，不可多写也不可漏写（verify:manifest 已断言三方一致）。

## 隐私做法标签（Data usage）写法要点

- 勾：**Website content**（用户主动触发才读当前页文本）、**Authentication credentials**（bbdc cookie 鉴权，但不读值）。
- 不勾：Website history、Personal communications、Health、Financial、Precise location 等全部其他项。
- 声明不出售、不用于无关用途、不用于信用评估。
- 表述红线（禁词表，`scripts/verify-claims.mjs` 强制）：不说"不上传/不收集任何数据"这类绝对化措辞——生词确实发送 bbdc.cn。正确口径："除推送生词到 bbdc.cn 外不发送任何数据到其他服务器""其余数据仅存本地"。

## 测试说明

- 分两段：第一段免登录可复现采集；第二段需 bbdc 账号验证推送。逐字来源 STORE-LISTING「测试说明」text 块。
