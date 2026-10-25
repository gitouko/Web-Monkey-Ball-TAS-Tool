import { hashSimState } from '@wmb/sim-hash';
import {
  COMMAND_EVENT,
  CONNECT_EVENT,
  PROTOCOL_VERSION,
  READY_EVENT,
  STATUS_EVENT,
  type TasCommand,
  type TasStatus,
} from '../shared/protocol.js';
import {
  classifyFixedTickAdvance,
  parseSpeedText,
  ReplayTimeline,
  sameRunIdentity,
  TasStateMachine,
  VirtualTimeDebt,
} from '../shared/tas-core.mjs';

type TasMode = TasStatus['mode'];

type ReplayHead = {
  parent: ReplayHead | null;
  frame: { x: number; y: number };
  length: number;
} | null;

type RunIdentity = {
  runGeneration: number;
  gameSource: string;
  stageId: number;
};

type GameExtraState = {
  score: number;
  lives: number;
  stageAttempts: number;
  readyAnnouncerPlayed: boolean;
  goAnnouncerPlayed: boolean;
  goalWooshPlayed: boolean;
  latchedClearTimerFrames: number | null;
  statusText: string;
  inputStartTick: number;
  autoRecordInputs: boolean;
  inputFeedIndex: number;
  replayInputStartTick: number | null;
  replayAutoFastForward: boolean;
  lastLocalInput: { x: number; y: number; buttons: number };
  resultReplayHistory: unknown[];
  activeResultReplay: unknown;
  resultReplayNeedsRestart: boolean;
};

type Checkpoint = {
  identity: RunIdentity;
  nativeState: any;
  extra: GameExtraState;
  replayHead: ReplayHead;
  replayLength: number;
  inputStartTick: number;
  simTick: number;
  hash: number;
  parent: Checkpoint | null;
  depth: number;
};

type ManualState = {
  id: number;
  label: string;
  checkpoint: Checkpoint;
  replayPrefix: Array<{ x: number; y: number }>;
};

type TasHookProxy = {
  onAfterSimTick: (event: { game: any; tick: number }) => void;
  attachTasController: (controller: TasController | null) => void;
};

type InstallOptions = {
  game: any;
  audio: any;
  hooks: TasHookProxy;
  buildCommit: string;
  expectedBundleSha256: string;
  isNetplayEnabled: () => boolean;
  isRunning: () => boolean;
};

const MAX_NATIVE_FRAME_SECONDS = 5 / 60;
const MAX_TICKS_PER_RENDER = 240;
const CPU_BUDGET_MS = 8;
const STATUS_INTERVAL_MS = 125;

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return structuredClone(value);
}

function estimateBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value !== 'object') return 0;
  if (seen.has(value as object)) return 0;
  seen.add(value as object);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + estimateBytes(entry, seen), 0);
  }
  let total = 0;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    total += key.length * 2 + estimateBytes(entry, seen);
  }
  return total;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[a-f0-9]{32,128}$/i.test(value)) {
    return null;
  }
  return value;
}

function isTasCommand(value: unknown): value is TasCommand {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== 'string') return false;
  switch (candidate.type) {
    case 'GET_STATUS':
    case 'PAUSE':
    case 'PLAY':
    case 'TOGGLE_PLAY':
    case 'STEP_FORWARD':
    case 'STEP_BACKWARD':
    case 'SAVE_STATE':
      return true;
    case 'SET_SPEED':
      return typeof candidate.value === 'string' && candidate.value.length <= 80;
    case 'LOAD_STATE':
    case 'DELETE_STATE':
      return Number.isSafeInteger(candidate.id) && Number(candidate.id) > 0;
    default:
      return false;
  }
}

function currentHash(game: any): number {
  const players = Array.isArray(game.players)
    ? [...game.players].sort((left, right) => left.id - right.id)
    : [];
  const balls = players.length > 0 ? players.map((player) => player.ball) : game.ball;
  const worlds = players.length > 0 ? players.map((player) => player.world) : game.world;
  return hashSimState(balls, worlds, game.stageRuntime, { includeVisual: false });
}

export function createTasModHooks(): TasHookProxy {
  let controller: TasController | null = null;
  return {
    onAfterSimTick(event) {
      controller?.afterSimTick(event.game, event.tick);
    },
    attachTasController(nextController) {
      controller = nextController;
    },
  };
}

export class TasController {
  private readonly game: any;
  private readonly audio: any;
  private readonly buildCommit: string;
  private readonly expectedBundleSha256: string;
  private readonly isNetplayEnabled: () => boolean;
  private readonly isRunning: () => boolean;
  private readonly stateMachine = new TasStateMachine();
  private readonly debt = new VirtualTimeDebt();
  private connected = false;
  private compatible = false;
  private token: string | null = null;
  private requestedSpeed = 1;
  private nativeBaseline = true;
  private runGeneration = 0;
  private stageRuntimeRef: object | null = null;
  private identity: RunIdentity | null = null;
  private currentCheckpoint: Checkpoint | null = null;
  private manualStates: ManualState[] = [];
  private nextManualStateId = 1;
  private branchGeneration = 0;
  private rewoundSinceCommit = false;
  private suppressCheckpointCapture = false;
  private dropNextDelta = false;
  private message = 'Waiting for the game bridge.';
  private lastStatusAt = 0;
  private snapshotTotalMs = 0;
  private snapshotCount = 0;
  private lastSnapshotMs = 0;
  private restoreTotalMs = 0;
  private restoreCount = 0;
  private estimatedSnapshotBytes = 0;

  constructor(options: InstallOptions) {
    this.game = options.game;
    this.audio = options.audio;
    this.buildCommit = options.buildCommit;
    this.expectedBundleSha256 = options.expectedBundleSha256.toLowerCase();
    this.isNetplayEnabled = options.isNetplayEnabled;
    this.isRunning = options.isRunning;
    options.hooks.attachTasController(this);

    window.addEventListener(CONNECT_EVENT, this.onConnect as EventListener);
    window.addEventListener(COMMAND_EVENT, this.onCommand as EventListener);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide, { once: true });
    this.announceReady();
  }

  private readonly onConnect = (event: CustomEvent) => {
    const detail = event.detail as Record<string, unknown> | null;
    const token = normalizeToken(detail?.token);
    const bundleHash = typeof detail?.liveBundleSha256 === 'string'
      ? detail.liveBundleSha256.toLowerCase()
      : '';
    if (!token || bundleHash !== this.expectedBundleSha256) {
      return;
    }
    if (this.token && this.token !== token) {
      return;
    }
    this.token = token;
    this.connected = true;
    this.compatible = true;
    this.message = 'Start a single-player stage.';
    this.ensureRun();
    this.emitStatus(true);
  };

  private readonly onCommand = (event: CustomEvent) => {
    const detail = event.detail as Record<string, unknown> | null;
    if (!this.connected || !this.compatible || detail?.token !== this.token || !isTasCommand(detail?.command)) {
      return;
    }
    try {
      this.handleCommand(detail.command);
    } catch (error) {
      this.stateMachine.reset('ERROR');
      this.message = `TAS error: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[Web-Monkey Ball TAS]', error);
    }
    this.emitStatus(true);
  };

  private readonly onVisibilityChange = () => {
    this.dropNextDelta = true;
    if (document.hidden) {
      this.debt.clear();
      this.game.accumulator = 0;
      this.nativeBaseline = false;
    }
  };

  private readonly onPageHide = () => {
    window.removeEventListener(CONNECT_EVENT, this.onConnect as EventListener);
    window.removeEventListener(COMMAND_EVENT, this.onCommand as EventListener);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.currentCheckpoint = null;
    this.manualStates.length = 0;
    this.stageRuntimeRef = null;
  };

  private announceReady() {
    window.dispatchEvent(new CustomEvent(READY_EVENT, {
      detail: {
        protocolVersion: PROTOCOL_VERSION,
        buildCommit: this.buildCommit,
        expectedBundleSha256: this.expectedBundleSha256,
      },
    }));
  }

  private handleCommand(command: TasCommand) {
    this.ensureRun();
    switch (command.type) {
      case 'GET_STATUS':
        return;
      case 'SET_SPEED':
        this.setSpeed(command.value);
        return;
      case 'PAUSE':
        this.pause('TAS paused.');
        return;
      case 'PLAY':
        this.play();
        return;
      case 'TOGGLE_PLAY':
        if (this.stateMachine.mode === 'PAUSED') this.play();
        else this.pause('TAS paused.');
        return;
      case 'STEP_FORWARD':
        this.stepForward();
        return;
      case 'STEP_BACKWARD':
        this.stepBackward();
        return;
      case 'SAVE_STATE':
        this.saveManualState();
        return;
      case 'LOAD_STATE':
        this.loadManualState(command.id);
        return;
      case 'DELETE_STATE':
        this.deleteManualState(command.id);
    }
  }

  private isReplayPlayback() {
    return this.game.replayInputStartTick !== null || !this.game.autoRecordInputs;
  }

  private isNativeLifecycleBoundary() {
    return !!this.game.pendingAdvance
      || !!this.game.loadingStage
      || !!this.game.paused
      || !this.game.stageRuntime
      || !this.game.stage
      || !this.game.getLocalPlayer?.()
      || !this.game.cameraController
      || !this.game.world
      || !this.game.running
      || !this.isRunning();
  }

  private canManipulate() {
    return !!this.identity
      && !!this.game.stageRuntime
      && !!this.game.stage
      && !this.game.loadingStage
      && !this.game.pendingAdvance
      && !this.game.singleplayerStageViewActive
      && !!this.game.getLocalPlayer?.()
      && !!this.game.cameraController
      && !!this.game.world
      && !!this.game.running
      && this.isRunning()
      && !this.isNetplayEnabled()
      && !this.isReplayPlayback();
  }

  private invalidateRun(message: string) {
    this.stageRuntimeRef = null;
    this.identity = null;
    this.currentCheckpoint = null;
    this.manualStates.length = 0;
    this.debt.clear();
    this.nativeBaseline = true;
    this.rewoundSinceCommit = false;
    this.stateMachine.reset(this.connected ? 'READY_NO_STAGE' : 'DETACHED');
    this.message = message;
  }

  private ensureRun() {
    const stageReady = !!this.game.stageRuntime
      && !!this.game.stage
      && !this.game.loadingStage
      && !this.game.pendingAdvance
      && !this.game.singleplayerStageViewActive
      && !!this.game.getLocalPlayer?.()
      && !!this.game.cameraController
      && !!this.game.world
      && !!this.game.running
      && this.isRunning();
    if (!stageReady) {
      if (this.identity || this.stateMachine.mode !== 'READY_NO_STAGE') {
        this.invalidateRun('Start a single-player stage.');
      }
      return;
    }
    if (this.isNetplayEnabled() || (Array.isArray(this.game.players) && this.game.players.length > 1)) {
      if (this.identity) this.invalidateRun('TAS controls are disabled in multiplayer.');
      else {
        this.stateMachine.reset('READY_NO_STAGE');
        this.message = 'TAS controls are disabled in multiplayer.';
      }
      return;
    }
    if (this.isReplayPlayback()) {
      if (this.identity) this.invalidateRun('TAS controls are disabled during replay playback.');
      else {
        this.stateMachine.reset('READY_NO_STAGE');
        this.message = 'TAS controls are disabled during replay playback.';
      }
      return;
    }
    if (this.stageRuntimeRef === this.game.stageRuntime && this.identity) {
      return;
    }

    this.runGeneration += 1;
    this.stageRuntimeRef = this.game.stageRuntime;
    this.identity = {
      runGeneration: this.runGeneration,
      gameSource: String(this.game.gameSource),
      stageId: Number(this.game.stage.stageId),
    };
    this.manualStates.length = 0;
    this.nextManualStateId = 1;
    this.debt.clear();
    this.game.accumulator = 0;
    this.nativeBaseline = this.requestedSpeed === 1;
    this.currentCheckpoint = this.captureCheckpoint(null, ReplayTimeline.fromInputs(this.game.inputRecord ?? []));
    this.rewoundSinceCommit = false;
    this.stateMachine.reset(this.requestedSpeed === 0 ? 'PAUSED' : 'PLAYING');
    this.message = `Stage ${this.identity.stageId} ready.`;
  }

  private leaveNativeBaseline() {
    if (!this.nativeBaseline) return;
    const accumulated = Number(this.game.accumulator);
    if (Number.isFinite(accumulated) && accumulated > 0) {
      this.debt.addSimulationSeconds(accumulated);
    }
    this.game.accumulator = 0;
    this.nativeBaseline = false;
  }

  private setSpeed(text: string) {
    const parsed = parseSpeedText(text);
    if (!parsed.ok) {
      this.message = parsed.reason;
      return;
    }
    if (parsed.value !== 1) {
      this.leaveNativeBaseline();
    }
    this.requestedSpeed = parsed.value;
    if (parsed.value === 0) {
      this.pause('Speed 0 is TAS pause.');
    } else {
      this.message = `Speed set to ${parsed.value}×.`;
    }
  }

  private pause(message: string) {
    if (!this.canManipulate()) {
      this.message = 'Pause unavailable: no active single-player stage.';
      return;
    }
    this.leaveNativeBaseline();
    this.stateMachine.transition('PAUSED');
    this.silenceRollingAudio();
    this.message = message;
  }

  private play() {
    if (!this.canManipulate()) {
      this.message = 'Play unavailable: no active single-player stage.';
      return;
    }
    if (this.requestedSpeed === 0) {
      this.message = 'Set Speed above 0 before playing.';
      return;
    }
    this.stateMachine.transition('PLAYING');
    this.dropNextDelta = true;
    this.message = `Playing at ${this.requestedSpeed}×.`;
  }

  private stepForward() {
    if (!this.canManipulate()) {
      this.message = 'Forward unavailable: no active single-player stage.';
      return;
    }
    this.leaveNativeBaseline();
    this.stateMachine.transition('PAUSED');
    if (this.game.paused) {
      this.message = 'Forward is blocked while the native pause menu is open.';
      return;
    }
    this.debt.clear();
    this.game.accumulator = 0;
    const before = this.game.simTick;
    this.runOneNativeTick();
    if (this.game.simTick !== before + 1) {
      throw new Error(`Forward advanced ${this.game.simTick - before} ticks; expected exactly 1.`);
    }
    this.message = `Advanced to tick ${this.game.simTick}.`;
  }

  private stepBackward() {
    if (!this.canManipulate()) {
      this.message = 'Rewind unavailable: no active single-player stage.';
      return;
    }
    this.leaveNativeBaseline();
    this.stateMachine.transition('PAUSED');
    const target = this.currentCheckpoint?.parent ?? null;
    if (!target) {
      this.message = 'Already at the first captured tick.';
      return;
    }
    this.restoreCheckpoint(target, ReplayTimeline.materialize(target.replayHead));
    this.currentCheckpoint = target;
    this.rewoundSinceCommit = true;
    this.message = `Rewound to tick ${target.simTick}.`;
  }

  private saveManualState() {
    if (!this.canManipulate() || !this.currentCheckpoint) {
      this.message = 'Save State failed: no active single-player stage.';
      return;
    }
    if (this.currentCheckpoint.simTick !== this.game.simTick) {
      throw new Error('Checkpoint and game tick are not aligned.');
    }
    const id = this.nextManualStateId++;
    const manualState: ManualState = {
      id,
      label: `State ${String(id).padStart(3, '0')}`,
      checkpoint: this.currentCheckpoint,
      replayPrefix: ReplayTimeline.materialize(this.currentCheckpoint.replayHead),
    };
    this.manualStates.push(manualState);
    this.message = `${manualState.label} saved at tick ${manualState.checkpoint.simTick}.`;
  }

  private loadManualState(id: number) {
    const state = this.manualStates.find((entry) => entry.id === id);
    if (!state || !this.identity || !sameRunIdentity(state.checkpoint.identity, this.identity)) {
      this.message = `Load blocked: State ${String(id).padStart(3, '0')} is not part of this run.`;
      return;
    }
    this.restoreCheckpoint(state.checkpoint, state.replayPrefix.map((input) => ({ ...input })));
    this.currentCheckpoint = state.checkpoint;
    this.rewoundSinceCommit = true;
    this.message = `${state.label} loaded at tick ${state.checkpoint.simTick}.`;
  }

  private deleteManualState(id: number) {
    const index = this.manualStates.findIndex((entry) => entry.id === id);
    if (index < 0) {
      this.message = `State ${String(id).padStart(3, '0')} was already removed.`;
      return;
    }
    const [removed] = this.manualStates.splice(index, 1);
    this.message = `${removed.label} deleted.`;
  }

  private captureExtraState(): GameExtraState {
    return {
      score: Number(this.game.score) || 0,
      lives: Number(this.game.lives) || 0,
      stageAttempts: Number(this.game.stageAttempts) || 0,
      readyAnnouncerPlayed: !!this.game.readyAnnouncerPlayed,
      goAnnouncerPlayed: !!this.game.goAnnouncerPlayed,
      goalWooshPlayed: !!this.game.goalWooshPlayed,
      latchedClearTimerFrames: Number.isFinite(this.game.latchedClearTimerFrames)
        ? Number(this.game.latchedClearTimerFrames)
        : null,
      statusText: typeof this.game.statusText === 'string' ? this.game.statusText : '',
      inputStartTick: Number(this.game.inputStartTick) || 0,
      autoRecordInputs: !!this.game.autoRecordInputs,
      inputFeedIndex: Number(this.game.inputFeedIndex) || 0,
      replayInputStartTick: Number.isFinite(this.game.replayInputStartTick)
        ? Number(this.game.replayInputStartTick)
        : null,
      replayAutoFastForward: !!this.game.replayAutoFastForward,
      lastLocalInput: {
        x: Number(this.game.lastLocalInput?.x) || 0,
        y: Number(this.game.lastLocalInput?.y) || 0,
        buttons: Number(this.game.lastLocalInput?.buttons) | 0,
      },
      resultReplayHistory: Array.isArray(this.game.resultReplayHistory)
        ? this.game.resultReplayHistory.slice()
        : [],
      activeResultReplay: this.game.activeResultReplay
        ? cloneValue(this.game.activeResultReplay)
        : null,
      resultReplayNeedsRestart: !!this.game.resultReplayNeedsRestart,
    };
  }

  private captureCheckpoint(parent: Checkpoint | null, replayHead: ReplayHead): Checkpoint {
    if (!this.identity) throw new Error('Cannot capture a checkpoint without a run identity.');
    const started = performance.now();
    const nativeState = this.game.saveRollbackState();
    if (!nativeState) throw new Error('Native rollback state is unavailable.');
    const extra = this.captureExtraState();
    const checkpoint: Checkpoint = {
      identity: { ...this.identity },
      nativeState,
      extra,
      replayHead,
      replayLength: Array.isArray(this.game.inputRecord) ? this.game.inputRecord.length : -1,
      inputStartTick: Number(this.game.inputStartTick) || 0,
      simTick: Number(this.game.simTick) || 0,
      hash: currentHash(this.game),
      parent,
      depth: (parent?.depth ?? -1) + 1,
    };
    this.lastSnapshotMs = performance.now() - started;
    this.snapshotTotalMs += this.lastSnapshotMs;
    this.snapshotCount += 1;
    if (this.estimatedSnapshotBytes === 0) {
      this.estimatedSnapshotBytes = estimateBytes(nativeState) + estimateBytes(extra);
    }
    return checkpoint;
  }

  afterSimTick(game: any, tick: number) {
    if (game !== this.game || !this.connected || !this.compatible || this.suppressCheckpointCapture) {
      return;
    }
    if (!this.identity || this.stageRuntimeRef !== this.game.stageRuntime || !this.canManipulate()) {
      return;
    }
    if (tick !== this.game.simTick) {
      throw new Error(`Simulation hook reported tick ${tick}, game reports ${this.game.simTick}.`);
    }
    const record = Array.isArray(this.game.inputRecord) ? this.game.inputRecord : null;
    const recordLength = record?.length ?? -1;
    let head = this.currentCheckpoint?.replayHead ?? null;
    const previousLength = this.currentCheckpoint?.replayLength ?? 0;
    if (record) {
      if (recordLength === previousLength + 1) {
        head = ReplayTimeline.append(head, record[recordLength - 1]);
      } else if (recordLength !== previousLength) {
        head = ReplayTimeline.fromInputs(record);
      }
    } else {
      head = null;
    }
    if (this.rewoundSinceCommit) {
      this.branchGeneration += 1;
      this.rewoundSinceCommit = false;
    }
    this.currentCheckpoint = this.captureCheckpoint(this.currentCheckpoint, head);
    if (this.currentCheckpoint.simTick !== tick || this.currentCheckpoint.replayLength !== recordLength) {
      throw new Error('Checkpoint boundary does not match simulation/replay boundary.');
    }
  }

  private runOneNativeTick() {
    const previousFixedMode = !!this.game.fixedTickMode;
    const previousTicksPerUpdate = Number(this.game.fixedTicksPerUpdate) || 1;
    try {
      this.game.setFixedTickMode(true, 1);
      this.game.update(this.game.fixedStep);
    } finally {
      this.game.setFixedTickMode(previousFixedMode, previousTicksPerUpdate);
      this.game.accumulator = 0;
    }
  }

  private processDebt() {
    const fixedStep = Number(this.game.fixedStep);
    const started = performance.now();
    let processed = 0;
    while (
      this.debt.availableTicks(fixedStep) > 0
      && processed < MAX_TICKS_PER_RENDER
      && performance.now() - started < CPU_BUDGET_MS
    ) {
      const before = this.game.simTick;
      this.runOneNativeTick();
      const result = classifyFixedTickAdvance(
        before,
        this.game.simTick,
        this.isNativeLifecycleBoundary(),
      );
      if (result !== 'ADVANCED') {
        // A native update may transiently decline a fixed tick while its own
        // state machine changes gates. No frame was simulated, so discard the
        // stale wall-clock debt and retry cleanly on the next render frame.
        this.debt.clear();
        this.game.accumulator = 0;
        break;
      }
      this.debt.consumeTick(fixedStep);
      processed += 1;
      if (!this.canManipulate()) {
        if (this.isNativeLifecycleBoundary()) this.debt.clear();
        break;
      }
    }
    return processed;
  }

  tick(dtSeconds: number) {
    if (!this.connected || !this.compatible) {
      this.game.update(dtSeconds);
      return;
    }
    this.ensureRun();
    if (!this.canManipulate()) {
      this.game.update(dtSeconds);
      this.emitStatus(false);
      return;
    }
    if (this.game.paused) {
      this.leaveNativeBaseline();
      this.emitStatus(false);
      return;
    }
    if (this.stateMachine.mode !== 'PLAYING' || this.requestedSpeed === 0) {
      this.emitStatus(false);
      return;
    }
    if (this.dropNextDelta || document.hidden) {
      dtSeconds = 0;
      this.dropNextDelta = false;
    }

    try {
      if (this.requestedSpeed === 1) {
        if (!this.nativeBaseline) {
          this.processDebt();
          if (this.debt.availableTicks(this.game.fixedStep) > 0) {
            this.emitStatus(false);
            return;
          }
          this.game.accumulator = this.debt.takeFraction();
          this.nativeBaseline = true;
        }
        this.game.update(dtSeconds);
      } else {
        this.leaveNativeBaseline();
        const safeRealDelta = Math.min(Math.max(0, Number(dtSeconds) || 0), MAX_NATIVE_FRAME_SECONDS);
        this.debt.add(safeRealDelta, this.requestedSpeed);
        this.processDebt();
      }
    } catch (error) {
      this.stateMachine.reset('ERROR');
      this.message = `Scheduler stopped: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[Web-Monkey Ball TAS]', error);
    }
    this.emitStatus(false);
  }

  private restoreExtraState(extra: GameExtraState) {
    this.game.score = extra.score;
    this.game.lives = extra.lives;
    this.game.stageAttempts = extra.stageAttempts;
    this.game.readyAnnouncerPlayed = extra.readyAnnouncerPlayed;
    this.game.goAnnouncerPlayed = extra.goAnnouncerPlayed;
    this.game.goalWooshPlayed = extra.goalWooshPlayed;
    this.game.latchedClearTimerFrames = extra.latchedClearTimerFrames;
    this.game.statusText = extra.statusText;
    this.game.inputStartTick = extra.inputStartTick;
    this.game.autoRecordInputs = extra.autoRecordInputs;
    this.game.inputFeedIndex = extra.inputFeedIndex;
    this.game.replayInputStartTick = extra.replayInputStartTick;
    this.game.replayAutoFastForward = extra.replayAutoFastForward;
    this.game.lastLocalInput = { ...extra.lastLocalInput };
    this.game.resultReplayHistory = extra.resultReplayHistory.slice();
    this.game.activeResultReplay = extra.activeResultReplay
      ? cloneValue(extra.activeResultReplay)
      : null;
    this.game.resultReplayNeedsRestart = extra.resultReplayNeedsRestart;
  }

  private restoreRaw(checkpoint: Checkpoint, replayPrefix: Array<{ x: number; y: number }>) {
    this.suppressCheckpointCapture = true;
    try {
      this.game.loadRollbackState(checkpoint.nativeState, { resetResultReplay: false });
      this.restoreExtraState(checkpoint.extra);
      this.game.inputRecord = replayPrefix.map((input) => ({ x: input.x, y: input.y }));
      this.game.inputStartTick = checkpoint.inputStartTick;
      this.game.accumulator = 0;
      this.game.setFixedTickMode(false, 1);
    } finally {
      this.suppressCheckpointCapture = false;
    }
  }

  private restoreCheckpoint(checkpoint: Checkpoint, replayPrefix: Array<{ x: number; y: number }>) {
    if (!this.identity || !sameRunIdentity(checkpoint.identity, this.identity)) {
      throw new Error('Checkpoint belongs to a different stage run.');
    }
    const fallback = this.currentCheckpoint;
    const fallbackPrefix = fallback ? ReplayTimeline.materialize(fallback.replayHead) : [];
    const priorMode = this.stateMachine.mode as TasMode;
    this.stateMachine.transition('RESTORING');
    this.debt.clear();
    this.nativeBaseline = false;
    const started = performance.now();
    try {
      this.restoreRaw(checkpoint, replayPrefix);
      const restoredHash = currentHash(this.game);
      if (this.game.simTick !== checkpoint.simTick) {
        throw new Error(`Restore tick mismatch: expected ${checkpoint.simTick}, got ${this.game.simTick}.`);
      }
      if (this.game.inputRecord.length !== checkpoint.replayLength) {
        throw new Error(`Restore replay length mismatch: expected ${checkpoint.replayLength}, got ${this.game.inputRecord.length}.`);
      }
      if (restoredHash !== checkpoint.hash) {
        throw new Error(`Restore state hash mismatch: expected ${checkpoint.hash}, got ${restoredHash}.`);
      }
      this.stateMachine.transition('PAUSED');
      this.silenceRollingAudio();
    } catch (error) {
      if (fallback) {
        try {
          this.restoreRaw(fallback, fallbackPrefix);
          this.currentCheckpoint = fallback;
          this.stateMachine.reset(priorMode === 'PLAYING' ? 'PAUSED' : priorMode);
        } catch (fallbackError) {
          console.error('[Web-Monkey Ball TAS] rollback of failed restore also failed', fallbackError);
          this.stateMachine.reset('ERROR');
        }
      } else {
        this.stateMachine.reset('ERROR');
      }
      throw error;
    } finally {
      const elapsed = performance.now() - started;
      this.restoreTotalMs += elapsed;
      this.restoreCount += 1;
    }
  }

  private silenceRollingAudio() {
    const players = Array.isArray(this.game.players) ? this.game.players : [];
    for (const player of players) {
      if (player?.ball?.audio) player.ball.audio.rollingVol = 0;
    }
    const rolling = this.audio?.rolling;
    if (!(rolling instanceof Map)) return;
    for (const state of rolling.values()) {
      try {
        state.source?.stop?.();
        state.source?.disconnect?.();
      } catch {
        // The source may already have stopped.
      }
      state.source = null;
      if (state.gain?.gain) state.gain.gain.value = 0;
      state.volume = 0;
    }
  }

  isSimulationPaused() {
    return this.connected
      && this.compatible
      && this.canManipulate()
      && (this.stateMachine.mode === 'PAUSED' || this.stateMachine.mode === 'RESTORING');
  }

  getInterpolationAlpha(nativeAlpha: number) {
    return this.isSimulationPaused() ? 1 : nativeAlpha;
  }

  private status(): TasStatus {
    const stageActive = this.canManipulate();
    return {
      protocolVersion: PROTOCOL_VERSION,
      buildCommit: this.buildCommit,
      connected: this.connected,
      compatible: this.compatible,
      mode: this.stateMachine.mode as TasMode,
      stageActive,
      nativePaused: !!this.game.paused,
      replayPlayback: this.isReplayPlayback(),
      netplay: this.isNetplayEnabled(),
      requestedSpeed: this.requestedSpeed,
      simTick: Number(this.game.simTick) || 0,
      replayLength: Array.isArray(this.game.inputRecord) ? this.game.inputRecord.length : 0,
      inputStartTick: Number(this.game.inputStartTick) || 0,
      rewindDepth: this.currentCheckpoint?.depth ?? 0,
      manualStates: this.manualStates.map((state) => ({
        id: state.id,
        label: state.label,
        simTick: state.checkpoint.simTick,
      })),
      message: this.message,
      diagnostics: {
        pendingSimulationSeconds: this.debt.seconds,
        averageSnapshotMs: this.snapshotTotalMs / Math.max(1, this.snapshotCount),
        lastSnapshotMs: this.lastSnapshotMs,
        averageRestoreMs: this.restoreTotalMs / Math.max(1, this.restoreCount),
        estimatedSnapshotBytes: this.estimatedSnapshotBytes,
        branchGeneration: this.branchGeneration,
        runGeneration: this.runGeneration,
        stateHash: this.game.stageRuntime ? currentHash(this.game) : 0,
      },
    };
  }

  private emitStatus(force: boolean) {
    if (!this.token) return;
    const now = performance.now();
    if (!force && now - this.lastStatusAt < STATUS_INTERVAL_MS) return;
    this.lastStatusAt = now;
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: { token: this.token, status: this.status() },
    }));
  }
}

export function installTasBridge(options: InstallOptions) {
  return new TasController(options);
}
