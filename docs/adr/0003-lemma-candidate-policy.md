# 词形还原候选政策:双上下文并发、词典内输出优先、名词平局

#48/#50/#52 三轮在同一 finalize 机制上打补丁后,「动词上下文先跑、命中即返回」的代码顺序仍产出整类错误 headword(lives→live 静默改变、wolves→姓氏 wolfe 被词典噪声「验证」通过)。决定(2026-10-10 grilling):动词+名词双 compromise 上下文并发收集候选,词典内输出优先于任何拼接救援,原词形在词典时优先于拼接;动词词元与名词词元都是词典词的平局判给**名词**(lives→life、leaves→leaf)。

## Considered Options

- **动词平局优先**(code-review finding 9 原案):规则最简、行为变化最小;但 nine lives→动词 live 的交叉 POS 合并正是 #52 第 1 条报的用户可见 bug,等于宣布该症状为官方政策。
- **词典频率裁决**(top-20000 排名取高者):词典排名语义是入选门槛不是精确频序,life/live、leaf/leave 排名相近近乎抛硬币,且引入对排名的隐式依赖,词典扩容时政策会飘。
- **最小补丁**(拼接候选 ve→f 先于 ve→fe 重排):不消灭类——hoof/loaf 类冷 f- 词继续静默失效,拼接验证仍可被词典噪声穿透。

## Consequences

- 存量词库与已推送至不背单词的词条不回溯,政策只影响新采集。
- 分歧集几乎全是 -ves 名词复数家族(wolf/wife/knife/loaf 的动词形根本不在词典,天然无平局);she leaves early 的 headword 会是 leaf,动词经裸形 leave 仍可采集。

## 关联决策(同日)

全大写词形按小写形折叠采集(THE→the、FOX→fox),专名排除仍以原始大小写先行判定(LONDON 仍算专名),缩略词黑名单照常拦截 FBI/NASA;语义见 CONTEXT.md「大小写折叠」词条。
