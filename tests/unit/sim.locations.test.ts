/**
 * Locations are upgrades you buy, not a reward the project number hands you.
 * The backdrop must follow ownership and nothing else.
 */
import { describe, expect, it } from 'vitest';
import {
  LOCATION_ORDER,
  STARTING_SCENE,
  UPGRADES,
  UPGRADE_BY_ID,
  createSim,
  currentScene,
  defaultMeta,
} from '../../src/sim/index.ts';

const locationIds = LOCATION_ORDER.filter((id): id is string => id !== null);

describe('locations', () => {
  it('starts in the bedroom with nothing owned', () => {
    expect(currentScene([])).toBe(STARTING_SCENE);
    expect(STARTING_SCENE).toBe('bedroom');
  });

  it('every location upgrade declares a scene and is kind "location"', () => {
    for (const id of locationIds) {
      const def = UPGRADE_BY_ID[id];
      expect(def, `${id} missing from UPGRADES`).toBeDefined();
      expect(def!.kind).toBe('location');
      expect(def!.scene, `${id} has no scene`).toBeTruthy();
    }
  });

  it('the ladder is a strict chain — each location requires the previous', () => {
    for (let i = 1; i < locationIds.length; i++) {
      const def = UPGRADE_BY_ID[locationIds[i]!]!;
      expect(def.requires?.upgrade).toBe(locationIds[i - 1]);
    }
    // The first one is buyable from the start.
    expect(UPGRADE_BY_ID[locationIds[0]!]!.requires).toBeUndefined();
  });

  it('the scene advances one step per location owned', () => {
    const owned: string[] = [];
    const seen = [currentScene(owned)];
    for (const id of locationIds) {
      owned.push(id);
      seen.push(currentScene(owned));
    }
    // Every step is a new, distinct room.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen[seen.length - 1]).toBe('orbital');
  });

  it('a gap in the chain does not skip ahead', () => {
    // Owning only the last location (impossible in play, but the renderer must
    // not be fooled by a corrupt save) still reports the bedroom.
    expect(currentScene(['loc_orbital'])).toBe(STARTING_SCENE);
    // A partial chain stops where the chain breaks.
    expect(currentScene(['loc_coworking', 'loc_datacenter'])).toBe('coworking');
  });

  it('the project number has no effect on the scene', () => {
    const sim = createSim({ seed: 5, meta: defaultMeta(), storage: null, autoStart: true });
    const before = currentScene(sim.run.owned);
    sim.run.projectIndex = 9;
    expect(currentScene(sim.run.owned)).toBe(before);
  });

  it('buying a location through the sim moves the room and costs slop', () => {
    const sim = createSim({ seed: 9, meta: defaultMeta(), storage: null, autoStart: true });
    const def = UPGRADE_BY_ID['loc_coworking']!;
    sim.run.slop = def.cost * 2;
    const before = sim.run.slop;

    expect(currentScene(sim.run.owned)).toBe('bedroom');
    expect(sim.buyUpgrade('loc_coworking')).toBe(true);
    expect(sim.run.slop).toBe(before - def.cost);
    expect(currentScene(sim.run.owned)).toBe('coworking');
  });

  it('locations are gated behind their predecessor at purchase time', () => {
    const sim = createSim({ seed: 11, meta: defaultMeta(), storage: null, autoStart: true });
    sim.run.slop = 1e12;
    // Cannot leapfrog straight to the data center.
    expect(sim.buyUpgrade('loc_datacenter')).toBe(false);
    expect(currentScene(sim.run.owned)).toBe('bedroom');
  });

  it('locations raise production, so the room is a real purchase', () => {
    const sim = createSim({ seed: 13, meta: defaultMeta(), storage: null, autoStart: true });
    sim.run.slop = 1e9;
    expect(sim.buyAgent('tab_autocomplete', 5)).toBe(true);
    const before = sim.derived().idleRate;
    expect(before).toBeGreaterThan(0);
    sim.buyUpgrade('loc_coworking');
    expect(sim.derived().idleRate).toBeGreaterThan(before);
  });

  it('exactly one location per scene key — no duplicates, no orphans', () => {
    const scenes = UPGRADES.filter((u) => u.kind === 'location').map((u) => u.scene);
    expect(new Set(scenes).size).toBe(scenes.length);
    expect(scenes).not.toContain(STARTING_SCENE);
  });
});
