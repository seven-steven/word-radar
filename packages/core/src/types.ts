/**
 * 核心领域类型。后续工单会往这里加提取 / 合并 / CSV 相关类型。
 */

export interface WordEntry {
  /** 词形还原后的基本形（如 running/runs/ran → "run"），主键。 */
  lemma: string;
  /**
   * 位掩码：bit0=不背单词已成功推送，bit1=有道（预留），
   * bit2=百词斩（预留），bit3=墨墨（预留）。0=全部待推。
   */
  flags: number;
}