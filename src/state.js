import { PLANETS } from './data.js';

export const SAVE_KEY = 'cosmic-frontier-save-v1';

export function createInitialState() {
  const worlds = Object.fromEntries(PLANETS.map((planet) => [planet.id, {
    buildings: [],
    welcomed: false,
    minedNodes: [],
  }]));
  return {
    version: 1,
    mode: 'space',
    currentPlanet: null,
    inventory: { ferrite: 52, carbon: 38, crystal: 18, credits: 0 },
    fuel: 72,
    landings: 0,
    mined: 0,
    refined: 0,
    visited: [],
    colonies: 0,
    worlds,
    ship: { position: [0, 8, 120], yaw: Math.PI, pitch: 0 },
    productionRemainder: 0,
    playSeconds: 0,
    lastSaved: Date.now(),
  };
}

export function normalizeState(input) {
  const base = createInitialState();
  if (!input || input.version !== 1) return base;
  const state = { ...base, ...input };
  state.inventory = { ...base.inventory, ...(input.inventory ?? {}) };
  state.ship = { ...base.ship, ...(input.ship ?? {}) };
  state.worlds = { ...base.worlds };
  PLANETS.forEach((planet) => {
    state.worlds[planet.id] = { ...base.worlds[planet.id], ...(input.worlds?.[planet.id] ?? {}) };
  });
  return state;
}

export function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(SAVE_KEY)));
  } catch {
    return createInitialState();
  }
}

export function hasSave() {
  try {
    return Boolean(localStorage.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}

export function saveState(state) {
  const snapshot = structuredClone(state);
  snapshot.lastSaved = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}
