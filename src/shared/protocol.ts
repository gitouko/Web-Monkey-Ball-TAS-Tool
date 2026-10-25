export const PROTOCOL_VERSION = 1;
export const EXPECTED_BUNDLE_SHA256 = '598c7a561f4c6cf1bce90741f507735b7d5258106cb779e07ddc5d51893abfa6';
export const READY_EVENT = '__WMB_TAS_READY_V1__';
export const CONNECT_EVENT = '__WMB_TAS_CONNECT_V1__';
export const COMMAND_EVENT = '__WMB_TAS_COMMAND_V1__';
export const STATUS_EVENT = '__WMB_TAS_STATUS_V1__';

export type TasCommand =
  | { type: 'GET_STATUS' }
  | { type: 'SET_SPEED'; value: string }
  | { type: 'PAUSE' }
  | { type: 'PLAY' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'STEP_FORWARD' }
  | { type: 'STEP_BACKWARD' }
  | { type: 'SAVE_STATE' }
  | { type: 'LOAD_STATE'; id: number }
  | { type: 'DELETE_STATE'; id: number };

export type TasStateSummary = {
  id: number;
  label: string;
  simTick: number;
};

export type TasStatus = {
  protocolVersion: number;
  buildCommit: string;
  connected: boolean;
  compatible: boolean;
  mode: 'DETACHED' | 'READY_NO_STAGE' | 'PLAYING' | 'PAUSED' | 'RESTORING' | 'ERROR';
  stageActive: boolean;
  nativePaused: boolean;
  replayPlayback: boolean;
  netplay: boolean;
  requestedSpeed: number;
  simTick: number;
  replayLength: number;
  inputStartTick: number;
  rewindDepth: number;
  manualStates: TasStateSummary[];
  message: string;
  diagnostics: {
    pendingSimulationSeconds: number;
    averageSnapshotMs: number;
    lastSnapshotMs: number;
    averageRestoreMs: number;
    estimatedSnapshotBytes: number;
    branchGeneration: number;
    runGeneration: number;
    stateHash: number;
  };
};
