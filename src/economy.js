import { BUILDINGS } from './data.js';

export const MAX_FUEL = 100;
export const FUEL_RECIPE = Object.freeze({ carbon: 10, crystal: 5 });

export function canAfford(inventory, cost) {
  return Object.entries(cost).every(([resource, amount]) => (inventory[resource] ?? 0) >= amount);
}

export function spendResources(inventory, cost) {
  if (!canAfford(inventory, cost)) return { ok: false, inventory };
  const next = { ...inventory };
  Object.entries(cost).forEach(([resource, amount]) => {
    next[resource] -= amount;
  });
  return { ok: true, inventory: next };
}

export function purchaseBuilding(inventory, buildingId) {
  const building = BUILDINGS[buildingId];
  if (!building) return { ok: false, reason: 'Unknown structure', inventory };
  const result = spendResources(inventory, building.cost);
  return { ...result, reason: result.ok ? '' : 'Not enough materials' };
}

export function refineFuel(inventory, currentFuel) {
  if (currentFuel >= MAX_FUEL) return { ok: false, reason: 'Fuel tanks are already full', inventory, fuel: currentFuel };
  const payment = spendResources(inventory, FUEL_RECIPE);
  if (!payment.ok) return { ok: false, reason: 'Requires 10 carbon and 5 crystal', inventory, fuel: currentFuel };
  return {
    ok: true,
    reason: '',
    inventory: payment.inventory,
    fuel: Math.min(MAX_FUEL, currentFuel + 25),
  };
}

export function calculateColony(buildings = [], welcomed = false) {
  const habitats = buildings.filter((building) => building.type === 'habitat').length;
  const extractors = buildings.filter((building) => building.type === 'extractor').length;
  const refineries = buildings.filter((building) => building.type === 'refinery').length;
  const beacons = buildings.filter((building) => building.type === 'beacon').length;
  const population = welcomed && beacons > 0 ? 8 + habitats * 12 : 0;
  const happiness = population ? Math.min(96, 62 + habitats * 7 + refineries * 2) : 0;
  const output = population ? 3 + extractors * 5 + refineries * 2 + Math.floor(population / 8) : 0;
  return { population, happiness, output };
}

export function formatCost(cost) {
  return Object.entries(cost)
    .map(([resource, amount]) => `${amount} ${resource === 'ferrite' ? 'Fe' : resource === 'carbon' ? 'C' : 'Cr'}`)
    .join(' · ');
}

export function accrueProduction(state, elapsedSeconds) {
  const next = structuredClone(state);
  let creditsPerMinute = 0;
  let ferritePerMinute = 0;
  Object.values(next.worlds).forEach((world) => {
    const stats = calculateColony(world.buildings, world.welcomed);
    creditsPerMinute += stats.output;
    ferritePerMinute += world.buildings.filter((building) => building.type === 'extractor').length * 2;
  });
  next.productionRemainder = (next.productionRemainder ?? 0) + elapsedSeconds;
  if (next.productionRemainder >= 10) {
    const cycles = Math.floor(next.productionRemainder / 10);
    next.productionRemainder -= cycles * 10;
    next.inventory.credits += Math.floor((creditsPerMinute / 6) * cycles);
    next.inventory.ferrite += Math.floor((ferritePerMinute / 6) * cycles);
  }
  return next;
}
