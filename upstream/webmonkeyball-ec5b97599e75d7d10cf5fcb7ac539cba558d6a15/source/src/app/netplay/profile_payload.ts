import type {
  PlayerProfile,
  PlayerProfileCosmetics,
  PlayerProfileCosmeticsChunkMessage,
} from '../../netcode_protocol.js';
import {
  sanitizeAvatarDataUrl,
  sanitizeBallTextureDataUrl,
  sanitizePlayerBillboardTextureDataUrl,
} from './profile_utils.js';

const PROFILE_COSMETICS_CHUNK_CHARS = 12 * 1024;

export type ProfileCosmeticsAssembly = {
  revision: number;
  chunkCount: number;
  chunks: string[];
  receivedCount: number;
};

export function stripProfileForNetwork(profile: PlayerProfile): PlayerProfile {
  const base: PlayerProfile = {
    name: profile.name,
  };
  const ball = profile.ball;
  if (ball) {
    const compactBall: NonNullable<PlayerProfile['ball']> = {};
    if (ball.hemi1Color) {
      compactBall.hemi1Color = ball.hemi1Color;
    }
    if (ball.hemi2Color) {
      compactBall.hemi2Color = ball.hemi2Color;
    }
    if (Object.keys(compactBall).length > 0) {
      base.ball = compactBall;
    }
  }
  return base;
}

export function extractProfileCosmetics(profile: PlayerProfile): PlayerProfileCosmetics | undefined {
  const cosmetics: PlayerProfileCosmetics = {};
  if (profile.avatarData) {
    cosmetics.avatarData = profile.avatarData;
  }
  if (profile.playerBillboardTexture) {
    cosmetics.playerBillboardTexture = profile.playerBillboardTexture;
  }
  const ball = profile.ball;
  if (ball) {
    const compactBall: NonNullable<PlayerProfileCosmetics['ball']> = {};
    if (ball.hemi1Texture) {
      compactBall.hemi1Texture = ball.hemi1Texture;
    }
    if (ball.hemi2Texture) {
      compactBall.hemi2Texture = ball.hemi2Texture;
    }
    if (ball.playerBillboardTexture) {
      compactBall.playerBillboardTexture = ball.playerBillboardTexture;
    }
    if (Object.keys(compactBall).length > 0) {
      cosmetics.ball = compactBall;
    }
  }
  return Object.keys(cosmetics).length > 0 ? cosmetics : undefined;
}

export function mergeProfileCosmetics(base: PlayerProfile, cosmetics?: PlayerProfileCosmetics): PlayerProfile {
  if (!cosmetics) {
    return {
      ...base,
      avatarData: undefined,
      playerBillboardTexture: undefined,
      ball: base.ball ? { ...base.ball } : undefined,
    };
  }
  const mergedBall = base.ball ? { ...base.ball } : {};
  if (cosmetics.ball?.hemi1Texture) {
    mergedBall.hemi1Texture = cosmetics.ball.hemi1Texture;
  }
  if (cosmetics.ball?.hemi2Texture) {
    mergedBall.hemi2Texture = cosmetics.ball.hemi2Texture;
  }
  if (cosmetics.ball?.playerBillboardTexture) {
    mergedBall.playerBillboardTexture = cosmetics.ball.playerBillboardTexture;
  }
  return {
    ...base,
    avatarData: cosmetics.avatarData,
    playerBillboardTexture: cosmetics.playerBillboardTexture,
    ball: Object.keys(mergedBall).length > 0 ? mergedBall : undefined,
  };
}

export function sanitizeProfileCosmetics(cosmetics?: PlayerProfileCosmetics): PlayerProfileCosmetics | undefined {
  if (!cosmetics) {
    return undefined;
  }
  const sanitized: PlayerProfileCosmetics = {};
  const avatarData = sanitizeAvatarDataUrl(cosmetics.avatarData);
  if (avatarData) {
    sanitized.avatarData = avatarData;
  }
  const playerBillboardTexture = sanitizePlayerBillboardTextureDataUrl(cosmetics.playerBillboardTexture);
  if (playerBillboardTexture) {
    sanitized.playerBillboardTexture = playerBillboardTexture;
  }
  if (cosmetics.ball) {
    const compactBall: NonNullable<PlayerProfileCosmetics['ball']> = {};
    const hemi1Texture = sanitizeBallTextureDataUrl(cosmetics.ball.hemi1Texture);
    const hemi2Texture = sanitizeBallTextureDataUrl(cosmetics.ball.hemi2Texture);
    const ballBillboardTexture = sanitizeBallTextureDataUrl(cosmetics.ball.playerBillboardTexture);
    if (hemi1Texture) {
      compactBall.hemi1Texture = hemi1Texture;
    }
    if (hemi2Texture) {
      compactBall.hemi2Texture = hemi2Texture;
    }
    if (ballBillboardTexture) {
      compactBall.playerBillboardTexture = ballBillboardTexture;
    }
    if (Object.keys(compactBall).length > 0) {
      sanitized.ball = compactBall;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function encodeProfileCosmeticsChunks(
  playerId: number,
  revision: number,
  cosmetics: PlayerProfileCosmetics,
): PlayerProfileCosmeticsChunkMessage[] {
  const payload = JSON.stringify(cosmetics);
  const chunkCount = Math.max(1, Math.ceil(payload.length / PROFILE_COSMETICS_CHUNK_CHARS));
  const messages: PlayerProfileCosmeticsChunkMessage[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * PROFILE_COSMETICS_CHUNK_CHARS;
    messages.push({
      type: 'player_profile_cosmetics_chunk',
      playerId,
      revision,
      chunkIndex,
      chunkCount,
      data: payload.slice(start, start + PROFILE_COSMETICS_CHUNK_CHARS),
    });
  }
  return messages;
}

export function applyProfileCosmeticsChunk(
  assemblyMap: Map<number, ProfileCosmeticsAssembly>,
  msg: PlayerProfileCosmeticsChunkMessage,
): PlayerProfileCosmetics | undefined {
  if (!Number.isFinite(msg.playerId) || msg.playerId <= 0) {
    return undefined;
  }
  const revision = Number(msg.revision);
  const chunkIndex = Number(msg.chunkIndex);
  const chunkCount = Number(msg.chunkCount);
  if (!Number.isFinite(revision) || revision <= 0 || !Number.isFinite(chunkIndex) || !Number.isFinite(chunkCount)) {
    return undefined;
  }
  const normalizedChunkIndex = Math.floor(chunkIndex);
  const normalizedChunkCount = Math.floor(chunkCount);
  if (normalizedChunkIndex < 0 || normalizedChunkCount <= 0 || normalizedChunkIndex >= normalizedChunkCount) {
    return undefined;
  }
  let assembly = assemblyMap.get(msg.playerId);
  if (!assembly || assembly.revision !== revision || assembly.chunkCount !== normalizedChunkCount) {
    assembly = {
      revision,
      chunkCount: normalizedChunkCount,
      chunks: new Array(normalizedChunkCount).fill(''),
      receivedCount: 0,
    };
    assemblyMap.set(msg.playerId, assembly);
  }
  if (!assembly.chunks[normalizedChunkIndex]) {
    assembly.receivedCount += 1;
  }
  assembly.chunks[normalizedChunkIndex] = msg.data;
  if (assembly.receivedCount < assembly.chunkCount) {
    return undefined;
  }
  assemblyMap.delete(msg.playerId);
  try {
    return JSON.parse(assembly.chunks.join('')) as PlayerProfileCosmetics;
  } catch {
    return undefined;
  }
}
