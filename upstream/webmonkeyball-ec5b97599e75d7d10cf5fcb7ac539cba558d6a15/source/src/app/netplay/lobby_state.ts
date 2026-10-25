import type { Game } from '../../game.js';
import type { HostRelay, ClientPeer } from '../../netplay.js';
import type { PlayerProfile, RoomGameModeOptions } from '../../netcode_protocol.js';
import {
  encodeProfileCosmeticsChunks,
  extractProfileCosmetics,
  stripProfileForNetwork,
} from './profile_payload.js';

type LobbyStateDeps = {
  game: Game;
  lobbyProfiles: Map<number, PlayerProfile>;
  localProfile: () => PlayerProfile;
  setLocalProfile: (profile: PlayerProfile) => void;
  saveLocalProfile: (profile: PlayerProfile) => void;
  updateLobbyUi: () => void;
  updateProfileUi: () => void;
  sanitizeProfile: (profile: PlayerProfile) => PlayerProfile;
  netplayRole: () => 'host' | 'client' | null;
  hostRelay: () => HostRelay | null;
  clientPeer: () => ClientPeer | null;
  setLastProfileBroadcastMs: (value: number | null) => void;
  getLastProfileBroadcastMs: () => number | null;
  profileBroadcastCooldownMs: number;
  getProfileBroadcastTimer: () => number | null;
  setProfileBroadcastTimer: (id: number | null) => void;
  lobbyRoom: () => any;
  isHost: () => boolean;
  lobbyMaxPlayersSelect: HTMLSelectElement | null;
  lobbyCollisionToggle: HTMLInputElement | null;
  lobbyInfiniteTimeToggle: HTMLInputElement | null;
  lobbyLockToggle: HTMLInputElement | null;
  lobbyRoomNameInput: HTMLInputElement | null;
  clampInt: (value: number, min: number, max: number) => number;
  getLobbyRoomGameMode: () => any;
  getLobbySelectedGameMode: () => any;
  getDefaultGameModeOptions: (mode: any) => RoomGameModeOptions;
  readLobbyGameModeOptionsFromInputs: (mode: any, fallbackRaw: unknown) => RoomGameModeOptions;
  lobbyDefaultPlayers: number;
  chainedDefaultPlayers: number;
  chainedMaxPlayers: number;
  lobbyMaxPlayers: number;
  broadcastRoomUpdate: () => void;
  sendLobbyHeartbeat: (nowMs: number, force?: boolean) => void;
  buildRoomMeta: () => any;
  setLastLobbyNameUpdateMs: (value: number | null) => void;
  getLastLobbyNameUpdateMs: () => number | null;
  lobbyNameUpdateCooldownMs: number;
  getLobbyNameUpdateTimer: () => number | null;
  setLobbyNameUpdateTimer: (id: number | null) => void;
  sanitizeLobbyName: (value: string) => string | undefined;
  applyGameMode: (
    mode: any,
    maxPlayers: number,
    collisionEnabled?: boolean,
    infiniteTimeEnabled?: boolean,
    gameModeOptions?: RoomGameModeOptions,
  ) => void;
  profileCosmeticsRevisionByPlayer: Map<number, number>;
};

export class LobbyStateController {
  private readonly deps: LobbyStateDeps;

  constructor(deps: LobbyStateDeps) {
    this.deps = deps;
  }

  applyLocalProfileToSession() {
    if (!Number.isFinite(this.deps.game.localPlayerId) || this.deps.game.localPlayerId <= 0) {
      return;
    }
    this.deps.lobbyProfiles.set(this.deps.game.localPlayerId, this.deps.localProfile());
  }

  private sendProfileCosmeticsToTargets(
    sourcePlayerId: number,
    profile: PlayerProfile,
    targetPlayerId?: number,
  ) {
    const cosmetics = extractProfileCosmetics(profile) ?? {};
    const revision = (this.deps.profileCosmeticsRevisionByPlayer.get(sourcePlayerId) ?? 0) + 1;
    this.deps.profileCosmeticsRevisionByPlayer.set(sourcePlayerId, revision);
    const chunks = encodeProfileCosmeticsChunks(sourcePlayerId, revision, cosmetics);
    if (chunks.length <= 0) {
      return;
    }
    if (targetPlayerId !== undefined) {
      const hostRelay = this.deps.hostRelay();
      if (!hostRelay) {
        return;
      }
      for (const chunk of chunks) {
        hostRelay.sendTo(targetPlayerId, chunk);
      }
      return;
    }
    const role = this.deps.netplayRole();
    if (role === 'host') {
      const hostRelay = this.deps.hostRelay();
      if (!hostRelay) {
        return;
      }
      for (const chunk of chunks) {
        hostRelay.broadcast(chunk);
      }
      return;
    }
    if (role === 'client') {
      const clientPeer = this.deps.clientPeer();
      if (!clientPeer) {
        return;
      }
      for (const chunk of chunks) {
        clientPeer.send(chunk);
      }
    }
  }

  sendStoredProfileToPeer(targetPlayerId: number, sourcePlayerId: number, profile: PlayerProfile) {
    const hostRelay = this.deps.hostRelay();
    if (!hostRelay) {
      return;
    }
    hostRelay.sendTo(targetPlayerId, {
      type: 'player_profile',
      playerId: sourcePlayerId,
      profile: stripProfileForNetwork(profile),
    });
    this.sendProfileCosmeticsToTargets(sourcePlayerId, profile, targetPlayerId);
  }

  broadcastLocalProfile() {
    const role = this.deps.netplayRole();
    if (!role) {
      return;
    }
    if (!Number.isFinite(this.deps.game.localPlayerId) || this.deps.game.localPlayerId <= 0) {
      return;
    }
    const current = this.deps.localProfile();
    const sanitized = this.deps.sanitizeProfile(current);
    if (JSON.stringify(sanitized) !== JSON.stringify(current)) {
      this.deps.setLocalProfile(sanitized);
      this.deps.saveLocalProfile(sanitized);
      this.deps.updateProfileUi();
    } else {
      this.deps.setLocalProfile(sanitized);
    }
    this.applyLocalProfileToSession();
    const localProfile = this.deps.localProfile();
    const payload = {
      type: 'player_profile',
      playerId: this.deps.game.localPlayerId,
      profile: stripProfileForNetwork(localProfile),
    } as const;
    if (role === 'host') {
      this.deps.hostRelay()?.broadcast(payload);
    } else if (role === 'client') {
      this.deps.clientPeer()?.send(payload);
    }
    this.sendProfileCosmeticsToTargets(this.deps.game.localPlayerId, localProfile);
    this.deps.setLastProfileBroadcastMs(performance.now());
    this.deps.updateLobbyUi();
  }

  scheduleProfileBroadcast() {
    const timer = this.deps.getProfileBroadcastTimer();
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    const nowMs = performance.now();
    const lastMs = this.deps.getLastProfileBroadcastMs() ?? 0;
    const cooldownRemaining = this.deps.profileBroadcastCooldownMs - (nowMs - lastMs);
    const waitMs = Math.max(300, cooldownRemaining);
    const nextTimer = window.setTimeout(() => {
      this.deps.setProfileBroadcastTimer(null);
      this.deps.setLastProfileBroadcastMs(performance.now());
      this.broadcastLocalProfile();
    }, waitMs);
    this.deps.setProfileBroadcastTimer(nextTimer);
  }

  applyLobbySettingsFromInputs() {
    const lobbyRoom = this.deps.lobbyRoom();
    if (!lobbyRoom || !this.deps.isHost()) {
      return;
    }
    const mode = this.deps.getLobbyRoomGameMode();
    const currentPlayers = this.deps.game.players.length;
    const requestedRaw = this.deps.lobbyMaxPlayersSelect ? Number(this.deps.lobbyMaxPlayersSelect.value) : lobbyRoom.settings.maxPlayers;
    const requestedMax = Number.isFinite(requestedRaw) ? requestedRaw : lobbyRoom.settings.maxPlayers;
    const minPlayers = mode === 'chained_together' ? 2 : Math.max(2, currentPlayers);
    const maxPlayersCap = mode === 'chained_together' ? this.deps.chainedMaxPlayers : this.deps.lobbyMaxPlayers;
    const nextMax = this.deps.clampInt(requestedMax, minPlayers, maxPlayersCap);
    const collisionEnabled = this.deps.lobbyCollisionToggle ? !!this.deps.lobbyCollisionToggle.checked : lobbyRoom.settings.collisionEnabled;
    const infiniteTimeEnabled = this.deps.lobbyInfiniteTimeToggle
      ? !!this.deps.lobbyInfiniteTimeToggle.checked
      : !!(lobbyRoom.settings.infiniteTimeEnabled ?? false);
    const locked = this.deps.lobbyLockToggle ? !!this.deps.lobbyLockToggle.checked : lobbyRoom.settings.locked;
    const gameModeOptions = this.deps.readLobbyGameModeOptionsFromInputs(mode, lobbyRoom.meta?.gameModeOptions);
    lobbyRoom.settings = {
      ...lobbyRoom.settings,
      maxPlayers: nextMax,
      collisionEnabled,
      infiniteTimeEnabled,
      locked,
    };
    const baseMeta = this.deps.buildRoomMeta() ?? lobbyRoom.meta ?? { status: 'lobby' };
    lobbyRoom.meta = {
      ...baseMeta,
      gameMode: mode,
      gameModeOptions: Object.keys(gameModeOptions).length > 0 ? gameModeOptions : undefined,
    };
    this.deps.applyGameMode(mode, nextMax, collisionEnabled, infiniteTimeEnabled, gameModeOptions);
    if (this.deps.lobbyMaxPlayersSelect) {
      this.deps.lobbyMaxPlayersSelect.value = String(nextMax);
    }
    this.deps.broadcastRoomUpdate();
    this.deps.sendLobbyHeartbeat(performance.now(), true);
    this.deps.updateLobbyUi();
  }

  applyLobbyGameModeFromInputs() {
    const lobbyRoom = this.deps.lobbyRoom();
    if (!lobbyRoom || !this.deps.isHost()) {
      return;
    }
    const mode = this.deps.getLobbySelectedGameMode();
    const currentPlayers = this.deps.game.players.length;
    const maxPlayersCap = mode === 'chained_together' ? this.deps.chainedMaxPlayers : this.deps.lobbyMaxPlayers;
    const minPlayers = Math.min(maxPlayersCap, Math.max(2, currentPlayers));
    const defaultMax = mode === 'chained_together' ? this.deps.chainedDefaultPlayers : this.deps.lobbyDefaultPlayers;
    const nextMax = this.deps.clampInt(defaultMax, minPlayers, maxPlayersCap);
    lobbyRoom.settings = {
      ...lobbyRoom.settings,
      maxPlayers: nextMax,
    };
    const gameModeOptions = this.deps.getDefaultGameModeOptions(mode);
    this.deps.applyGameMode(mode, nextMax, undefined, undefined, gameModeOptions);
    const baseMeta = this.deps.buildRoomMeta() ?? lobbyRoom.meta ?? { status: 'lobby' };
    lobbyRoom.meta = {
      ...baseMeta,
      gameMode: mode,
      gameModeOptions: Object.keys(gameModeOptions).length > 0 ? gameModeOptions : undefined,
    };
    if (this.deps.lobbyMaxPlayersSelect) {
      this.deps.lobbyMaxPlayersSelect.value = String(nextMax);
    }
    this.deps.broadcastRoomUpdate();
    this.deps.sendLobbyHeartbeat(performance.now(), true);
    this.deps.updateLobbyUi();
  }

  applyLobbyNameFromInput() {
    const lobbyRoom = this.deps.lobbyRoom();
    if (!lobbyRoom || !this.deps.isHost()) {
      return;
    }
    const sanitized = this.deps.sanitizeLobbyName(this.deps.lobbyRoomNameInput?.value ?? '');
    if (this.deps.lobbyRoomNameInput && (sanitized ?? '') !== this.deps.lobbyRoomNameInput.value) {
      this.deps.lobbyRoomNameInput.value = sanitized ?? '';
    }
    const nextName = sanitized ?? undefined;
    const currentName = lobbyRoom.meta?.roomName;
    if (currentName === nextName) {
      return;
    }
    const baseMeta = this.deps.buildRoomMeta() ?? lobbyRoom.meta ?? { status: 'lobby' };
    lobbyRoom.meta = { ...baseMeta, roomName: nextName };
    this.deps.setLastLobbyNameUpdateMs(performance.now());
    this.deps.broadcastRoomUpdate();
    this.deps.sendLobbyHeartbeat(performance.now(), true);
    this.deps.updateLobbyUi();
  }

  scheduleLobbyNameUpdate() {
    const timer = this.deps.getLobbyNameUpdateTimer();
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    const nowMs = performance.now();
    const lastMs = this.deps.getLastLobbyNameUpdateMs() ?? 0;
    const cooldownRemaining = this.deps.lobbyNameUpdateCooldownMs - (nowMs - lastMs);
    const waitMs = Math.max(300, cooldownRemaining);
    const nextTimer = window.setTimeout(() => {
      this.deps.setLobbyNameUpdateTimer(null);
      this.applyLobbyNameFromInput();
    }, waitMs);
    this.deps.setLobbyNameUpdateTimer(nextTimer);
  }

  applyLobbyStageSelection() {
    const lobbyRoom = this.deps.lobbyRoom();
    if (!lobbyRoom || !this.deps.isHost()) {
      return;
    }
    const meta = this.deps.buildRoomMeta();
    if (!meta) {
      return;
    }
    lobbyRoom.meta = meta;
    this.deps.broadcastRoomUpdate();
    this.deps.sendLobbyHeartbeat(performance.now(), true);
    this.deps.updateLobbyUi();
  }
}
