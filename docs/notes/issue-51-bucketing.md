# issue #51 黑名单守卫外残余碰撞分桶报告

2026-09-26 执行，规格见 #51 评论（grilling 定稿：分桶先行，只观测不修复）。

## 输入

- 分桶对象：Norvig 排名 5006–9966 的 **570 词**（572 碰撞 = md@1464 + doc@2660 豁免 + 570），由 `scripts/audit-blacklist-collisions.mjs` 离线复算导出，口径断言与勘误评论逐字一致（top-1000=0、top-3000={md,doc}、top-10000=572、570 词全落 5006–9966）。
- 70 净增词条（上游漂移）：对 Norvig 全表验证，34 词有排名但仅 `exec@8746` 落 top-10000（已在 570 分桶对象内），其余全部 ≥14172 深尾——**无高频命中风险，验完归档**。

## 方法

1. LLM 全量初判三桶（6 批 sonnet 并行，判据=ADR-0002「有词源独立的词义即误杀」，多义词看有无不看哪个义更常用）
2. 哨兵校准：13 个已知答案词盲测
3. 抽检：两桶各固定 seed 随机抽 10 词，独立 opus 盲复判
4. lemma 修正：分桶判的是黑名单**词条**，用户被过滤的是 **lemma 化后**的匹配（CONTEXT.md：docs→doc 命中）——用 core 的 `lemma.ts` 真实还原器对全部词条实测命中面

## 结果（570 词）

| 桶                       | 词数 | 占比  |
| ------------------------ | ---- | ----- |
| true-clip（真缩略）      | 338  | 59.3% |
| false-kill（有独立词义） | 211  | 37.0% |
| unsure（存疑，待人工核） | 21   | 3.7%  |

### lemma 修正后的用户可见面

| 分类                    | 词数    | 占 570    | 说明                                                                                                                          |
| ----------------------- | ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **用户可见真误杀**      | **187** | **32.8%** | lemma 命中：sad/silent/egg/powder/wash/juice/steam/damn/mars/rod/eve/witch/lamb/frog/spice/ant/nut/pig/moss/mug…              |
| 有效拦截（真 clipping） | 316     | 55.4%     | hrs/rpm/fbi/nato/ssl/dns…                                                                                                     |
| 死条目（false-kill 侧） | 24      | 4.2%      | platforms/caps/fed/puts/chose 等 复数·屈折形，lemma 还原原型后放行（platform/cap/feed/put/choose 不在黑名单），**不构成误杀** |
| 死条目（true-clip 侧）  | 24      | 4.2%      | ns/tvs/cms/bios/mods 等复数缩写，lemma 化掉 s 后单数形不在黑名单，纯体积冗余                                                  |
| 存疑                    | 21      | 3.7%      | 待人工核                                                                                                                      |

**核心决策数字：守卫外碰撞段用户可见误杀 187/570 = 32.8%**，有效拦截 : 真误杀 ≈ 1.7 : 1——远超「该收的比误杀的多」直觉的隐含预期，数据显著指向「值得修」。最终「修 or 接受」由人工决策（规格：不预埋阈值）。

> **账目勘误（2026-10-10 完结审计发现）**：上表五行合计 572 ≠ 570（+2）。
> 用户可见真误杀 187 = false-kill 桶 211 − 死条目 24，独立自洽；不平出在
> true-clip 侧（316 + 24 = 340 ≠ 桶 338）——最可能是「有效拦截 316」的
> 口径混入了 2 个 570 集合之外的词（md/doc 豁免词条最可疑），或死条目
> 计数差 2。核心决策数字（187 / 32.8% / ≈1.7:1）不受影响。下次黑名单
> 再生成时以 `scripts/audit-blacklist-collisions.mjs` 重算消解（本次
> Norvig 缓存已失，无法离线复核）。

## 哨兵校准过程（11/13 → 重审 → 13/13）

盲测 11/13：`pee`、`cal` 被判 true-clip（预期 false-kill）。两词是「缩略起源、词典已词汇化」的判据边界词——LLM 忠于判据字面（词源可溯源），哨兵预期暗含「常用度」轴，两轴天然分歧；其余 11 词全对、21 词双盲重判零冲突，属**判据边界问题而非执行噪声**。

重审决议（用户 2026-09-26 定）：pee/cal 改入 unsure 随存疑桶人工核；哨兵语义精化为「不得错分，边界词归 unsure 可接受」。重跑 13/13 通过。

## 抽检结果

**抽检 20 词错分率 0/20**——true-clip 抽 10（tf/sim/sync/rj/mf/val/cz/isp/seq/rh）、false-kill 抽 10（span/mud/calm/mesa/dam/gi/wit/tar/hugo/mae），独立 opus 盲复判与初判（sonnet）完全一致。复判 41/41 全部经 Wiktionary REST API + wikitext 词源段实查（证据留存 `/tmp/wikt/`），非纯模型记忆。

**存疑 21 词二判倾向**（供人工核参考，正式桶维持 unsure 不变）：13 词倾向 false-kill（cal/turbo/ted/ist/das/sox/ooo/dod/nat/benz/nam/una/til——多靠冷门独立义翻案：cal=康沃尔钨矿旧义、ted=中古英语「晒草」、til=印地语「芝麻」）；7 词倾向 true-clip（je/fg/aj/jm/ver/rn/cg——「无英文词条仅缩写」）；pee 维持 unsure。若人工采纳倾向，三桶将变为 345/224/1。

## 执行事故记录（自愈，无需行动）

- 分派侧批次词表手工切分错位：批 4 少发 21 词（经补判）、批 5 实发 81 词（与批 4 尾部重叠 21）、批 6 实发 130 词（头部接住批 5 缺段）、批 3 实发 85 词。聚合断言验证六批并集恰好 570/570 零缺口零多词，批次重叠由 21 词双盲重判零冲突兜底。
- agent 消息截断 2 起，改为文件落盘回收（bucket-*.json）。

## 待人工事项 → 处置记录（2026-10-10）

1. **存疑 21 词**：已裁决（49-agent 多源核查 + 分歧仲裁，Wiktionary 全页词源级证据）——false-kill 12（turbo/ted/ist/das/sox/ooo/dod/nat/benz/una/til/fg；til 翻案：ME til ← OE 是古英语独立存活词形，非 until 截短）、true-clip 6（je/aj/jm/ver/rn/cg）、unsure 3（cal/nam/pee——判据边界簇，随词汇化家族留观）。三桶终态 **344/223/3**。
2. **抽检 20 词**：第三轮多源核查错分 **1/20**（sim 被推翻为 false-kill——现代常用名词义已词汇化；机器两轮 true-clip 的「现代义全标 clipping」依据成立但判据边界裁决反向）。
3. **「修 or 接受」**：用户拍板**修**（2026-10-10）。数字刷新：用户可见真误杀 198/570=34.7%、拦截:误杀≈1.58:1。

### 修复执行（v3 小写词条页主动否决）

- 机制：v2.1 小写自证否决只对「类目来源恰好含小写页」生效——sad 类真词只有全大写变体页（SAD）入类目，否决不可达。v3 对纯度幸存词主动拉取小写词条页，`reason==="mixed"`（词条真实存在且混合词义）即否决；redirect / no-english / no-defs / pure 不构成否决（FBI 类零误伤）。`alt case` / `alternative form of`（大小写/异写变体页，如 rpm→RPM、img→IMG）计入缩略族模板防过杀。
- 落地：生成器（build-blacklist.mjs 层1）+ 词条级 patch（scripts/patch-blacklist-lowercase-veto.mjs，对已提交产物执行，避免 2.5h 类目重爬与上游漂移噪音）；纯度判定链抽至 scripts/lib/wikitext.mjs 单一事实源。
- 结果：**16190 → 14667 词**（剔除 1523）。分桶报告的误杀代表词（sad/silent/egg/wash/juice/steam/eve/til/fg/das…）全部出榜（blacklist-data.test 哨兵钉死）；真缩写代表（fbi/ssl/rpm/img/dns/gpu/ssd）留存钉死。

### 出榜口径明示（判据字面的自然推论，产品语义变化）

- **词汇化网络/技术缩写出榜**：asap/aka/lol/afk/afaik/imo/omg/atm/cpu/usb/pdf/nato/ai/io——小写词条页已有非缩略词性用法（mixed），按「有独立非缩略词义即不算缩略语」判据字面出榜；大写形态（NASA/CPU 类）由专名排除兜底。
- **模板盲点出榜**：hrs（{{plural of|en|hr}}——模板目标身份不可判定）、tvs（lemma→tv 死条目，无损失）。
- **留榜的词汇化边界家族（grilling 后备）**：sim/sync（小写页全义标 clipping → pure）、turbo（小写页半缩略占比过线）、doc/stat/cal/pee——「截短已词汇化」的判据分歧未由 v3 裁决，留观。

## 复现

```
node scripts/audit-blacklist-collisions.mjs   # 需要 /tmp Norvig 断点缓存或 --norvig=count_1w.txt
node /tmp/word-radar-issue51/aggregate.mjs    # 分桶聚合（哨兵+占比+抽样）
```

中间产物：`/tmp/word-radar-issue51/`（bucket-{1..6}.json、aggregate.json、lemma-check.json）——重启即丢，关键数字以本报告与 aggregate.json 摘要为准。
