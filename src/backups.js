// Copyright (C) 2026 Ryan L. Melvin. SPDX-License-Identifier: GPL-3.0-only
import { validateSave } from './game.js';

const SAVE_KEY = /^daily:(?:(v[3-7]):)?(\d{4}-\d{2}-\d{2})$/;
const STATUS_RANK = { lost: 0, playing: 1, won: 2 };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSound = (value) => value === 'on' || value === 'off';

function readRun(key, serialized) {
  try {
    const match = SAVE_KEY.exec(key);
    if (!match || typeof serialized !== 'string') return null;
    const [, version, date] = match;
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
    const run = JSON.parse(serialized);
    if (!isRecord(run) || run.date !== date || typeof run.status !== 'string' || !Object.hasOwn(STATUS_RANK, run.status)) return null;
    const schemas = version ? [Number(version.slice(1))] : [2, 3];
    if (!schemas.includes(run.schema) || !Number.isInteger(run.floor) || run.floor < 0 || run.floor > 2) return null;
    if (version === 'v7' && !validateSave(run, date)) return null;
    return { run, archived: version !== 'v7' };
  } catch { return null; }
}

function preferIncoming(current, incoming) {
  const difference = STATUS_RANK[incoming.status] - STATUS_RANK[current.status];
  if (difference !== 0) return difference > 0;
  return incoming.status === 'playing' && incoming.floor > current.floor;
}

/** Plan a union of saved editions without modifying inputs or browser storage. */
export function planBackupMerge(currentMap, data) {
  if (!(currentMap instanceof Map)) throw new TypeError('Current progress must be a Map.');
  if (!isRecord(data) || data.app !== 'dungeon-chess-daily' || data.schema !== 1 || !isRecord(data.saves)) {
    throw new Error('Choose a Dungeon Chess Daily backup.');
  }

  // Validate every incoming entry before planning even the first storage write.
  const incoming = Object.entries(data.saves).map(([key, value]) => {
    if (key === 'sound') {
      if (!isSound(value)) throw new Error('This backup contains an invalid sound preference.');
      return { key, value };
    }
    const entry = readRun(key, value);
    if (!entry) throw new Error('This backup contains an unreadable save.');
    return { key, value, ...entry };
  });

  const writes = new Map();
  const unreadable = [];
  let archived = false;
  for (const { key, value, run, archived: olderRules } of incoming) {
    if (key === 'sound') {
      if (!isSound(currentMap.get(key))) writes.set(key, value);
      continue;
    }
    archived ||= olderRules;
    if (!currentMap.has(key)) {
      writes.set(key, value);
      continue;
    }
    const current = readRun(key, currentMap.get(key));
    if (!current) {
      unreadable.push(key);
      continue;
    }
    if (preferIncoming(current.run, run)) writes.set(key, value);
  }
  return { writes, archived, unreadable };
}
