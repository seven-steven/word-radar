# 手工验收清单

本清单用于 WordRadar v0.1.0 发布前的端到端手工走查。扩展走查需要在 Chrome 与 Edge 上各做一遍。
所有步骤都基于「已构建、未改动 dist」的状态——开始之前先 `pnpm -r build` 一次。

## 0. 准备工作

- [ ] 仓库根执行 `pnpm install && pnpm -r build`，确认无报错。
- [ ] 仓库根执行 `pnpm -r test && pnpm -r typecheck`，确认 258 个测试全绿、类型检查通过。
- [ ] 仓库根执行 `pnpm package`，确认产出 `dist/word-radar-extension.zip`。
- [ ] 解压 zip 到 `/tmp/word-radar-unpacked`（或任意目录），确认 `manifest.json` 在解压根目录。
- [ ] 浏览器里提前登录 <https://bbdc.cn/>（确认能看到首页的「已登录」状态）。

---

## 1. Chrome 加载 dist 全流程走查

- [ ] 打开 `chrome://extensions/`，开启「开发者模式」。
- [ ] 点「加载已解压的扩展程序」，选择 `packages/extension/dist`（或 zip 解压后的目录）。
- [ ] 预期：工具栏出现 WordRadar 图标，扩展管理页无报错红点。
- [ ] 新开标签页，打开 <https://bbdc.cn/>，确认已登录。
- [ ] 点击工具栏 WordRadar 图标，打开 popup：
  - [ ] 「检查登录」按钮点一下，状态切换为「已登录不背单词」（绿色）。
  - [ ] 「打开不背单词」按钮隐藏（已登录时不应出现）。
- [ ] 新开标签页，打开一篇英文文章（例如 Medium 上任意英文文章、或 <https://en.wikipedia.org/wiki/Word>）。
- [ ] 点击 WordRadar 图标：
  - [ ] popup 自动采集，状态栏显示「本次采集 N 词」（N ≥ 1）。
  - [ ] 「累计采集」与「待推」计数递增。
  - [ ] 推送状态从「空闲」→「推送中 M/N：<当前词>」→「推送完成」。
  - [ ] 成功计数递增，失败计数保持 0。
- [ ] 回到 <https://bbdc.cn/>，打开「我的生词本」页面：
  - [ ] 能看到刚才采集的词逐个出现（翻页 / 搜索）。
- [ ] 关闭 popup 再重新打开，预期「累计采集」数字持久化（IndexedDB），不丢失。

---

## 2. Edge 同样走查

- [ ] 打开 `edge://extensions/`，开启「开发人员模式」。
- [ ] 点「加载解压缩的扩展」，选择同一 `dist` 目录。
- [ ] 重复第 1 节所有步骤：
  - [ ] popup 检查登录 → 已登录。
  - [ ] 英文文章页采集 → 计数递增。
  - [ ] 推送状态流转正常。
  - [ ] 生词本页能看到对应词。

---

## 3. 推送中断恢复

### 3.a 登出触发暂停

- [ ] 在扩展推送进行中（状态为「推送中 M/N」），新标签页打开 <https://bbdc.cn/> 并**登出**不背单词。
- [ ] 等推送协调器下一次请求失败：
  - [ ] popup 推送状态切换为「推送已暂停：<原因>」（含错误信息）。
  - [ ] 「失败」计数递增。
  - [ ] 「重试待推」按钮可点击（非禁用状态）。
- [ ] 在浏览器里重新登录 <https://bbdc.cn/>。
- [ ] 点「重试待推」：
  - [ ] 推送状态恢复为「推送中 M/N」。
  - [ ] 剩余待推词陆续成功推送。
  - [ ] 最终状态「推送完成」。

### 3.b 断网触发暂停

- [ ] 推送进行中，断开网络（飞行模式或拔网线）。
- [ ] 等推送协调器 3 次重试耗尽：
  - [ ] popup 推送状态变为「推送已暂停：<网络错误>」。
  - [ ] 已经成功的词计数保持不变。
- [ ] 恢复网络。
- [ ] 点「重试待推」，预期续推剩余词直至「推送完成」。

---

## 4. 重复采集去重

- [ ] 在同一个英文文章页，点 WordRadar 图标第一次采集，记录「累计采集 N」。
- [ ] 关闭 popup，再点一次（或点「重新采集」按钮）：
  - [ ] 「累计采集」数字**不增加**（或仅计入真正新增的词，重复词不累加）。
  - [ ] 「待推」数字不增加（除非上一轮有失败/未推的）。
  - [ ] 推送完成后，「已存在」计数递增（说明服务端识别为重复）。
- [ ] 回 <https://bbdc.cn/> 生词本页，确认**同一词只出现一次**（不重复）。

---

## 5. CSV 导出 → CLI merge → 导入往返

- [ ] 扩展里累积一些词之后，popup 点「导出 CSV」：
  - [ ] 浏览器下载一个 `word-radar-YYYYMMDD-HHmm.csv` 文件。
  - [ ] 用编辑器/终端查看，格式为 `lemma,flags`（每行一条，flags 为十进制整数）。
  - [ ] 已推的 `flags` 位 0 为 1；未推的为 0。
- [ ] 准备两份 CSV：
  - `a.csv`（扩展导出的）。
  - `b.csv`（手工编辑或另一份导出，包含部分与 a 重复的 lemma）。
- [ ] 运行 CLI 合并：

  ```bash
  node packages/cli/dist/index.js merge a.csv b.csv -o merged.csv
  ```

  - [ ] 命令成功，`merged.csv` 里每个 lemma 只出现一次。
  - [ ] 重复 lemma 的 `flags` 是 a、b 两边的按位 OR（已推 + 待推 → 已推）。

- [ ] 回到扩展 popup，点「导入 CSV」，选 `merged.csv`：
  - [ ] popup 同步状态显示「导入完成：累计 X / 待推 Y」。
  - [ ] 累计数等于合并后 CSV 的行数（不含表头）。
  - [ ] 已推过的词不会被洗回待推（待推数 ≤ CSV 里 flags=0 的行数）。
- [ ] 反向验证：导入后立即「导出 CSV」，新导出的 CSV 与 `merged.csv` 内容一致（lemma 集合相同、flags 相同，顺序允许不同）。

---

## 6. CLI extract / merge 在真实文件上跑通

### 6.a extract 单文件

- [ ] 准备一份真实英文文章文本，保存为 `/tmp/wr-test.md`。
- [ ] 运行：

  ```bash
  node packages/cli/dist/index.js extract /tmp/wr-test.md
  ```

  - [ ] 终端 stderr 输出进度行 `<input> → <output> (N words)`。
  - [ ] 同目录生成 `/tmp/wr-test.words.csv`。
  - [ ] CSV 表头为 `lemma,flags`，每行一个词，全部 `flags=0`。
  - [ ] 词形还原正确：文章里 `running` / `runs` / `ran` 在 CSV 里只有一条 `run`。

### 6.b extract 单文件 + `-o`

- [ ] 运行：

  ```bash
  node packages/cli/dist/index.js extract /tmp/wr-test.md -o /tmp/custom.csv
  ```

  - [ ] 输出写入 `/tmp/custom.csv`，不存在 `/tmp/wr-test.words.csv`（被覆盖或跳过）。

### 6.c extract 目录

- [ ] 准备目录 `/tmp/wr-dir/`，包含 `a.md`、`b.txt`、`sub/c.md`、`.hidden.md`、`skip.json`。
- [ ] 运行：

  ```bash
  node packages/cli/dist/index.js extract /tmp/wr-dir
  ```

  - [ ] 生成 `a.md.words.csv`、`b.txt.words.csv`、`sub/c.md.words.csv`。
  - [ ] `.hidden.md` 被忽略（隐藏文件）。
  - [ ] `skip.json` 被忽略（非 `.md` / `.txt`）。

### 6.d extract 错误路径（错误只打印一次）

- [ ] 运行 `node packages/cli/dist/index.js extract /nonexistent`：
  - [ ] stderr 输出**一行**错误 `word-radar: Error: Path does not exist: /nonexistent`。
  - [ ] **不出现重复的第二行**相同错误信息。
  - [ ] 进程非零退出（`echo $?` ≠ 0）。
- [ ] 运行 `node packages/cli/dist/index.js merge`（缺参数）：
  - [ ] stderr 输出**一行** commander 错误。
  - [ ] 不重复打印。
  - [ ] 进程非零退出。
- [ ] 运行 `node packages/cli/dist/index.js merge only-one.csv`：
  - [ ] stderr 输出**一行** `word-radar: Error: merge requires at least 2 input files`。
  - [ ] 不重复打印。

### 6.e merge 真实文件

- [ ] 用 6.a 生成的 CSV + 另一份 CSV，跑：

  ```bash
  node packages/cli/dist/index.js merge file1.words.csv file2.words.csv -o merged.csv
  ```

  - [ ] 命令成功，`merged.csv` 每个 lemma 唯一。
  - [ ] stderr 输出 `Merged 2 files → <path> (N words)`。

- [ ] 不传 `-o` 时，CSV 直接打印到 stdout：

  ```bash
  node packages/cli/dist/index.js merge a.csv b.csv > out.csv
  ```

  - [ ] stdout 是合法 CSV，可被扩展「导入 CSV」读取。

### 6.f merge 坏行错误

- [ ] 手工准备一个坏 CSV `bad.csv`（某行缺字段 / 格式错）：
  - [ ] 运行 `merge good.csv bad.csv`。
  - [ ] stderr 输出**一行** `word-radar: Error in bad.csv: CSV parse error at line N: ...`。
  - [ ] 不重复打印。
  - [ ] 进程非零退出；`good.csv` 不被污染。

---

## 验收签字

- [ ] Chrome 全流程（§1）通过。
- [ ] Edge 全流程（§2）通过。
- [ ] 推送中断恢复（§3）通过。
- [ ] 重复采集去重（§4）通过。
- [ ] CSV 往返（§5）通过。
- [ ] CLI extract / merge 真实文件（§6）通过。

验收人 / 日期：********\_\_\_\_********
