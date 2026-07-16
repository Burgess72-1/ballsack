import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accrueProduction,
  calculateColony,
  canAfford,
  purchaseBuilding,
  refineFuel,
  spendResources,
} from '../src/economy.js';
import { createInitialState, normalizeState } from '../src/state.js';

test('canAfford checks every required resource', () => {
  const inventory = { ferrite: 20, carbon: 10, crystal: 0 };
  assert.equal(canAfford(inventory, { ferrite: 18, carbon: 8 }), true);
  assert.equal(canAfford(inventory, { ferrite: 18, crystal: 1 }), false);
});

test('spendResources is immutable and refuses incomplete payments', () => {
  const inventory = { ferrite: 20, carbon: 10 };
  const success = spendResources(inventory, { ferrite: 8, carbon: 2 });
  assert.equal(success.ok, true);
  assert.deepEqual(success.inventory, { ferrite: 12, carbon: 8 });
  assert.deepEqual(inventory, { ferrite: 20, carbon: 10 });

  const failed = spendResources(inventory, { ferrite: 25 });
  assert.equal(failed.ok, false);
  assert.equal(failed.inventory, inventory);
});

test('building purchase applies the catalog cost', () => {
  const inventory = { ferrite: 50, carbon: 30, crystal: 20, credits: 0 };
  const result = purchaseBuilding(inventory, 'beacon');
  assert.equal(result.ok, true);
  assert.deepEqual(result.inventory, { ferrite: 15, carbon: 8, crystal: 8, credits: 0 });
});

test('fuel refinery consumes reagents and caps the tank', () => {
  const inventory = { ferrite: 0, carbon: 20, crystal: 10 };
  const result = refineFuel(inventory, 88);
  assert.equal(result.ok, true);
  assert.equal(result.fuel, 100);
  assert.equal(result.inventory.carbon, 10);
  assert.equal(result.inventory.crystal, 5);
  assert.equal(refineFuel(inventory, 100).ok, false);
});

test('colony statistics grow with habitats and industry', () => {
  const buildings = [
    { type: 'beacon' }, { type: 'habitat' }, { type: 'habitat' },
    { type: 'extractor' }, { type: 'refinery' },
  ];
  assert.deepEqual(calculateColony(buildings, false), { population: 0, happiness: 0, output: 0 });
  assert.deepEqual(calculateColony(buildings, true), { population: 32, happiness: 78, output: 14 });
});

test('production grants colony credits in ten-second cycles', () => {
  const state = createInitialState();
  state.worlds.aurelia.welcomed = true;
  state.worlds.aurelia.buildings = [{ type: 'beacon' }, { type: 'habitat' }, { type: 'extractor' }];
  const next = accrueProduction(state, 60);
  assert.ok(next.inventory.credits > state.inventory.credits);
  assert.ok(next.inventory.ferrite > state.inventory.ferrite);
  assert.equal(state.inventory.credits, 0);
});

test('state normalization restores missing world fields', () => {
  const state = normalizeState({
    version: 1,
    fuel: 44,
    inventory: { ferrite: 2 },
    worlds: { aurelia: { welcomed: true } },
  });
  assert.equal(state.fuel, 44);
  assert.equal(state.inventory.ferrite, 2);
  assert.equal(state.inventory.carbon, 38);
  assert.equal(state.worlds.aurelia.welcomed, true);
  assert.deepEqual(state.worlds.aurelia.buildings, []);
  assert.ok(state.worlds.viridia);
});
