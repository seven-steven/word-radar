# Chrome Web Store 必交材料清单（平台层规范）

> 平台规范随时间变化，提交时以 Developer Dashboard 实际表单限制为准；下述为编写材料时的基线。

## Store listing（语言集 = zh）

本项目 Listing 语言集声明为**简体中文（zh）**——扩展 UI、README、文档均为中文（FACTS.md §4）。双语场景采用"声明制"：只需在 Dashboard 选定默认语言并填写该语言文案，可选填其他语言；本项目只维护 zh 一套文案，来源为 `docs/chrome-web-store/STORE-LISTING.md` 的 ```text 块（唯一来源，直接复制）。

| 材料                   | 规范                                      | 来源                                                           |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| 名称                   | ≤75 字符（建议 ≤45）                      | `package.json` description 同源名称                            |
| 简短描述               | ≤132 字符                                 | STORE-LISTING「简短描述」text 块                               |
| 详细描述               | 约 ≤16,000 字符                           | STORE-LISTING「详细描述」text 块                               |
| 类别                   | 单选                                      | STORE-LISTING「类别」（效率工具 / Productivity Tools）         |
| 截图                   | 1280×800 或 640×400；至少 1 张，至多 5 张 | `docs/chrome-web-store/screenshots/`（`pnpm screenshot` 生成） |
| 图标                   | 128×128                                   | `packages/extension/src/icons/icon-128.png`                    |
| Homepage / Support URL | 有效 URL                                  | STORE-LISTING「支持与官网 URL」                                |

## Privacy

- Privacy policy URL：`docs/chrome-web-store/PRIVACY.md` 的 GitHub blob URL（如 `https://github.com/seven-steven/word-radar/blob/<tag-or-main>/docs/chrome-web-store/PRIVACY.md`）。
- Data usage 勾选口径：见 STORE-LISTING「隐私做法标签」text 块。

## 上传包

- `dist/word-radar-<version>-chrome.zip`（`pnpm build && pnpm package` 产出；`pnpm verify:zip` 断言结构）。

## 人工填写项（绝不入仓库）

- 测试账号（bbdc 账号 + 登录方式）：仅填 Developer Dashboard 的测试账号栏。仓库任何文件不得出现账号/密码明文（FACTS.md §6）。

## 引用方式

- 一切对外声明的事实依据在 `docs/chrome-web-store/FACTS.md`；文案改动必须能回溯到 FACTS，`pnpm verify:claims` 断言一致性。FACTS 变则先改 FACTS 再改文案层。
