export function parseSpeedText(text) {
  const trimmed = String(text).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return { ok: false, reason: 'Enter a finite number at or above 0.' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, reason: 'Enter a finite number at or above 0.' };
  }
  return { ok: true, value };
}

export class VirtualTimeDebt {
  #seconds = 0;

  get seconds() {
    return this.#seconds;
  }

  add(realSeconds, speed) {
    if (!Number.isFinite(realSeconds) || realSeconds <= 0 || !Number.isFinite(speed) || speed <= 0) {
      return this.#seconds;
    }
    const added = realSeconds * speed;
    this.#seconds = Number.isFinite(added + this.#seconds)
      ? added + this.#seconds
      : Number.MAX_VALUE;
    return this.#seconds;
  }

  addSimulationSeconds(seconds) {
    if (Number.isFinite(seconds) && seconds > 0) {
      this.#seconds = Math.min(Number.MAX_VALUE, this.#seconds + seconds);
    }
    return this.#seconds;
  }

  availableTicks(fixedStep) {
    if (!Number.isFinite(fixedStep) || fixedStep <= 0) {
      return 0;
    }
    const ratio = this.#seconds / fixedStep;
    return Math.floor(ratio + 1e-9);
  }

  consumeTick(fixedStep) {
    if (this.availableTicks(fixedStep) <= 0) {
      return false;
    }
    this.#seconds = Math.max(0, this.#seconds - fixedStep);
    return true;
  }

  takeFraction() {
    const value = this.#seconds;
    this.#seconds = 0;
    return value;
  }

  clear() {
    this.#seconds = 0;
  }
}

export function classifyFixedTickAdvance(beforeTick, afterTick, lifecycleBlocked) {
  const advanced = Number(afterTick) - Number(beforeTick);
  if (advanced === 1) {
    return 'ADVANCED';
  }
  if (advanced === 0) {
    return lifecycleBlocked ? 'LIFECYCLE_BOUNDARY' : 'STALLED';
  }
  throw new Error(`Scheduler tick advanced ${advanced} frames.`);
}

export class ReplayTimeline {
  static empty() {
    return null;
  }

  static append(head, input) {
    const frame = Object.freeze({ x: input.x | 0, y: input.y | 0 });
    return Object.freeze({ parent: head, frame, length: (head?.length ?? 0) + 1 });
  }

  static fromInputs(inputs) {
    let head = null;
    for (const input of inputs ?? []) {
      head = ReplayTimeline.append(head, input);
    }
    return head;
  }

  static materialize(head) {
    const length = head?.length ?? 0;
    const result = new Array(length);
    let cursor = head;
    for (let index = length - 1; index >= 0; index -= 1) {
      result[index] = { x: cursor.frame.x, y: cursor.frame.y };
      cursor = cursor.parent;
    }
    return result;
  }
}

const TRANSITIONS = {
  DETACHED: new Set(['READY_NO_STAGE', 'PLAYING', 'PAUSED', 'ERROR']),
  READY_NO_STAGE: new Set(['PLAYING', 'PAUSED', 'DETACHED', 'ERROR']),
  PLAYING: new Set(['PAUSED', 'READY_NO_STAGE', 'DETACHED', 'ERROR', 'RESTORING']),
  PAUSED: new Set(['PLAYING', 'READY_NO_STAGE', 'DETACHED', 'ERROR', 'RESTORING']),
  RESTORING: new Set(['PAUSED', 'ERROR']),
  ERROR: new Set(['DETACHED', 'READY_NO_STAGE']),
};

export class TasStateMachine {
  #mode = 'DETACHED';

  get mode() {
    return this.#mode;
  }

  transition(next) {
    if (next === this.#mode) {
      return this.#mode;
    }
    if (!TRANSITIONS[this.#mode]?.has(next)) {
      throw new Error(`Invalid TAS transition ${this.#mode} -> ${next}`);
    }
    this.#mode = next;
    return this.#mode;
  }

  reset(next = 'DETACHED') {
    if (!TRANSITIONS[next]) {
      throw new Error(`Unknown TAS mode: ${next}`);
    }
    this.#mode = next;
  }
}

export function sameRunIdentity(left, right) {
  return !!left
    && !!right
    && left.runGeneration === right.runGeneration
    && left.gameSource === right.gameSource
    && left.stageId === right.stageId;
}
