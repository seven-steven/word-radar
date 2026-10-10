import type { BackgroundRepository } from "./background-listener.js";
import type { PushCoordinator } from "./push-coordinator.js";

/**
 * 推送轮触发来源（issue #54 Wave D）：三入口的准入策略此前散落三处
 * （CONFIRM 分支 / handleCheckLogin / resumePendingPush），各自注释自辩；
 * 收拢为本模块的单一决策点。
 */
export type PushTrigger = "confirm" | "login-recovery" | "cold-start";

export interface PushTriggerDeps {
  /** 待推池查询的最小面（BackgroundRepository.listPending）。 */
  repository: Pick<BackgroundRepository, "listPending">;
  pushCoordinator: PushCoordinator;
}

/**
 * 推送轮三入口的单一准入决策点（issue #54 Wave D）。
 *
 * 不变量锚点：「确认即推送是唯一路径」（issue #22）指 采集/导入→确认→推送
 * 的主路径；login-recovery / cold-start 两个恢复入口是对存量待推的兜底
 * 重推，不是自动推送开关。
 *
 * - confirm：用户显式确认动作——无条件 `void start()`，不查池不查相位
 *   （BUSY 去重与补轮是 PushCoordinator 的职责，issue #47）。
 * - login-recovery：登录恢复后查待推池；空池跳过、查库失败跳过（吞错，
 *   与 cold-start 同语义——下次 SW 唤醒再试）。issue #36：零词轮会空转
 *   出「推送完成 0/0/0」噪音回执。issue #57 门控：BUSY 期改走 startIfIdle
 *   （返回 null、不置补轮标记）——补轮标记只属于真实改动待推池的调用方
 *   （confirm）；此前 BUSY 期弹窗 boot 的 CHECK_LOGIN 无条件 start() 置
 *   标记，每次开弹窗都空转出一轮 0/0/0。忙判定看 running promise：paused
 *   （登录失效暂停，登录恢复正是它的重推入口）与 completed（failed 词仍
 *   待推）不算 BUSY。
 * - cold-start：SW 冷启动恢复（issue #26），准入同 login-recovery，另加
 *   相位为 idle 才起——不抢进行中的轮。
 */
export async function admitPushRound(
  trigger: PushTrigger,
  deps: PushTriggerDeps,
): Promise<void> {
  if (trigger === "confirm") {
    void deps.pushCoordinator.start();
    return;
  }
  const pending = await deps.repository.listPending().catch(() => undefined);
  if (!pending || pending.length === 0) return;
  if (trigger === "login-recovery") {
    void deps.pushCoordinator.startIfIdle();
    return;
  }
  if (deps.pushCoordinator.getStatus().phase !== "idle") {
    return;
  }
  void deps.pushCoordinator.start();
}
