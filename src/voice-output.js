export const VOICE_PRIORITY = Object.freeze({
  MANUAL_COACH: 100,
  MANUAL_PLAYBACK: 95,
  MOVE_QUIP: 80,
  AUTO_COACH: 60,
  POSITION_QUIP: 30,
  TEST: 10,
});

function normalizePriority(value, fallback = VOICE_PRIORITY.POSITION_QUIP) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1000, Math.round(number)));
}

function normalizeGeneration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number));
}

/**
 * 只负责语音任务的排序与失效，不直接操作 speechSynthesis。
 * 这样同一套优先级规则可以在浏览器和单元测试中复用。
 */
export class VoiceOutputQueue {
  constructor({ maxQueue = 8, now = () => Date.now() } = {}) {
    this.maxQueue = Math.max(1, Number(maxQueue) || 8);
    this.now = now;
    this.sequence = 0;
    this.pending = [];
    this.active = null;
  }

  enqueue(item = {}) {
    const text = String(item.text || "").trim();
    if (!text) return null;
    this.sequence += 1;
    // chunks 只对"一句长语音切成多个短片"的场景有意义。
    // 保留在任务上，播放器据此把整段话作为一个原子任务播完。
    const chunks = Array.isArray(item.chunks)
      ? item.chunks
          .map((chunk) => String(chunk || "").trim())
          .filter(Boolean)
      : [];
    const task = {
      id: item.id || `voice-${this.sequence}`,
      text,
      chunks,
      channel: item.channel || "manual",
      priority: normalizePriority(item.priority),
      generation: normalizeGeneration(item.generation),
      auto: Boolean(item.auto),
      rate: Number.isFinite(Number(item.rate)) ? Number(item.rate) : 1.5,
      voiceUri: typeof item.voiceUri === "string" ? item.voiceUri : "",
      createdAt: Number.isFinite(Number(item.createdAt))
        ? Number(item.createdAt)
        : this.now(),
      sequence: this.sequence,
    };
    this.pending.push(task);
    this.pending.sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.sequence - right.sequence;
    });
    if (this.pending.length > this.maxQueue) {
      this.pending = this.pending.slice(0, this.maxQueue);
    }
    return task;
  }

  takeNext() {
    if (this.active || !this.pending.length) return null;
    this.active = this.pending.shift();
    return this.active;
  }

  finish(id) {
    if (!this.active || (id && this.active.id !== id)) return null;
    this.active = null;
    return this.takeNext();
  }

  /**
   * 新一步棋到来时，只清理旧局面的自动内容。
   * 正在播放的一句必须完整结束；手动点击或重听任务也继续保留。
   */
  invalidateGeneration(generation) {
    const currentGeneration = normalizeGeneration(generation);
    this.pending = this.pending.filter((task) => {
      if (!task.auto) return true;
      return task.generation >= currentGeneration;
    });
    return this.pending.length;
  }

  /**
   * 关闭某一路功能时，只清理它尚未播放的内容；正在说的一句仍然说完。
   */
  removePendingChannels(channels) {
    const blocked = new Set(
      (Array.isArray(channels) ? channels : [channels])
        .map((channel) => String(channel || "").trim())
        .filter(Boolean),
    );
    if (!blocked.size) return this.pending.length;
    this.pending = this.pending.filter((task) => !blocked.has(task.channel));
    return this.pending.length;
  }

  clear({ cancelActive = true } = {}) {
    const current = cancelActive ? this.active : null;
    this.pending = [];
    if (cancelActive) this.active = null;
    return current;
  }

  get size() {
    return this.pending.length;
  }
}
