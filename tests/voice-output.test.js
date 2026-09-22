import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_PRIORITY,
  VoiceOutputQueue,
} from "../src/voice-output.js";

test("voice queue plays one item at a time", () => {
  const queue = new VoiceOutputQueue();
  queue.enqueue({ text: "第一句", priority: VOICE_PRIORITY.MOVE_QUIP });
  queue.enqueue({ text: "第二句", priority: VOICE_PRIORITY.AUTO_COACH });

  assert.equal(queue.takeNext().text, "第一句");
  assert.equal(queue.takeNext(), null);
  assert.equal(queue.finish().text, "第二句");
});

test("voice queue prioritizes manual coach speech over automatic speech", () => {
  const queue = new VoiceOutputQueue();
  queue.enqueue({
    text: "自动教练",
    priority: VOICE_PRIORITY.AUTO_COACH,
    createdAt: 1,
  });
  queue.enqueue({
    text: "手动教练",
    priority: VOICE_PRIORITY.MANUAL_COACH,
    createdAt: 2,
  });
  queue.enqueue({
    text: "新一步吐槽",
    priority: VOICE_PRIORITY.MOVE_QUIP,
    createdAt: 3,
  });

  assert.equal(queue.takeNext().text, "手动教练");
  assert.equal(queue.finish().text, "新一步吐槽");
  assert.equal(queue.finish().text, "自动教练");
});

test("new move invalidates old automatic speech but keeps manual playback", () => {
  const queue = new VoiceOutputQueue();
  queue.enqueue({
    text: "旧局面吐槽",
    priority: VOICE_PRIORITY.POSITION_QUIP,
    generation: 4,
    auto: true,
  });
  queue.enqueue({
    text: "旧一步教练",
    priority: VOICE_PRIORITY.AUTO_COACH,
    generation: 4,
    auto: true,
  });
  queue.enqueue({
    text: "用户重听",
    priority: VOICE_PRIORITY.MANUAL_PLAYBACK,
    generation: 4,
    auto: false,
  });
  queue.enqueue({
    text: "新一步吐槽",
    priority: VOICE_PRIORITY.MOVE_QUIP,
    generation: 5,
    auto: true,
  });

  queue.invalidateGeneration(5);
  assert.equal(queue.size, 2);
  assert.equal(queue.takeNext().text, "用户重听");
  assert.equal(queue.finish().text, "新一步吐槽");
});

test("stop clears active and pending speech", () => {
  const queue = new VoiceOutputQueue();
  queue.enqueue({ text: "正在说的句子" });
  assert.equal(queue.takeNext().text, "正在说的句子");
  queue.enqueue({ text: "等待中的句子" });
  assert.equal(queue.clear().text, "正在说的句子");
  assert.equal(queue.size, 0);
  assert.equal(queue.takeNext(), null);
});

test("closing one voice channel keeps the other channel queued", () => {
  const queue = new VoiceOutputQueue();
  queue.enqueue({ text: "待播吐槽", channel: "quip" });
  queue.enqueue({ text: "待播教练", channel: "coach" });

  queue.removePendingChannels("quip");

  assert.equal(queue.size, 1);
  assert.equal(queue.takeNext().text, "待播教练");
});
