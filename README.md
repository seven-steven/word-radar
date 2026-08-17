# 单词雷达 (WordRadar)

> 把网页里的英文生词一键提取出来，自动加到「不背单词」生词本。

详细产品形态与架构见 [`docs/spec.md`](./docs/spec.md)。

## 包结构

| 包                      | 角色                                            | 构建                      | 入口            |
| ----------------------- | ----------------------------------------------- | ------------------------- | --------------- |
| `@word-radar/core`      | 共享纯 TypeScript 核心（提取 / 词形还原 / CSV） | tsup → dist               | `dist/index.js` |
| `@word-radar/cli`       | Node CLI：清洗本地文本 / 合并词表               | tsup → dist（含 shebang） | `dist/index.js` |
| `@word-radar/extension` | Chrome/Edge MV3 扩展（主形态）                  | Vite + @crxjs/vite-plugin | `dist/`         |

`extension` 与 `cli` 只通过包名（`@word-radar/core`）消费 core，禁止 `import` `core/src`。

## 开发

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm -r typecheck
```
