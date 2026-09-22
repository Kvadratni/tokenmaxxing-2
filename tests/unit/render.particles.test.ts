import { describe, expect, it } from 'vitest';
import { C_AMBER, PARTICLE_CAP, ParticleSystem } from '../../src/render/particles.ts';
import { createMockCtx } from './render.mock-ctx.ts';

const ctx = () =>
  createMockCtx(document.createElement('canvas')) as unknown as CanvasRenderingContext2D;

describe('pool bounds', () => {
  it('defaults to a 1024-slot pool', () => {
    const p = new ParticleSystem();
    expect(p.capacity).toBe(PARTICLE_CAP);
    expect(p.poolSize).toBe(PARTICLE_CAP);
  });

  it('spawning 10,000 particles never exceeds the cap and never grows the pool', () => {
    const p = new ParticleSystem(256);
    const poolBefore = p.poolSize;
    for (let i = 0; i < 10_000; i++) {
      p.spawnMote(160, 100);
      expect(p.count).toBeLessThanOrEqual(p.capacity);
    }
    expect(p.count).toBe(256);
    expect(p.poolSize).toBe(poolBefore);
    expect(p.spawned).toBe(10_000);
    // Everything past the first 256 had to reuse a slot.
    expect(p.recycled).toBe(10_000 - 256);
  });

  it('bursts respect the cap too', () => {
    const p = new ParticleSystem(64);
    p.burstConfetti(10, 10, 5000);
    p.burstShards(10, 10, 5000);
    p.burstSparks(10, 10, 5000);
    expect(p.count).toBe(64);
    expect(p.poolSize).toBe(64);
  });

  it('a capacity of zero or nonsense still yields a usable pool', () => {
    expect(new ParticleSystem(0).capacity).toBe(1);
    expect(new ParticleSystem(-5).capacity).toBe(1);
    const p = new ParticleSystem(0);
    p.spawnMote(0, 0);
    expect(p.count).toBe(1);
  });
});

describe('expiry and recycling', () => {
  it('particles expire and their slots return to the free list', () => {
    const p = new ParticleSystem(128);
    for (let i = 0; i < 20; i++) p.spawnText(10, 10, 'HI', { ttl: 0.5 });
    expect(p.count).toBe(20);

    // Run past the ttl. update() clamps each step to 100ms.
    for (let i = 0; i < 20; i++) p.update(0.1);
    expect(p.count).toBe(0);
    expect(p.poolSize).toBe(128);
    expect(p.recycled).toBe(0); // freed cleanly, never force-evicted
  });

  it('reuses freed slots rather than growing', () => {
    const p = new ParticleSystem(32);
    for (let cycle = 0; cycle < 40; cycle++) {
      for (let i = 0; i < 32; i++) p.spawnText(0, 0, 'X', { ttl: 0.2 });
      expect(p.count).toBe(32);
      for (let i = 0; i < 5; i++) p.update(0.1);
      expect(p.count).toBe(0);
      expect(p.poolSize).toBe(32);
    }
    expect(p.spawned).toBe(32 * 40);
    expect(p.recycled).toBe(0);
  });

  it('clear() empties the pool and restores every slot', () => {
    const p = new ParticleSystem(64);
    p.burstConfetti(0, 0, 64);
    expect(p.count).toBe(64);
    p.clear();
    expect(p.count).toBe(0);
    // Full capacity is available again immediately, with no eviction.
    p.burstConfetti(0, 0, 64);
    expect(p.count).toBe(64);
    expect(p.recycled).toBe(0);
  });

  it('ignores non-positive and absurd timesteps', () => {
    const p = new ParticleSystem(16);
    p.spawnMote(0, 0);
    p.update(0);
    p.update(-1);
    p.update(Number.NaN);
    expect(p.count).toBe(1);
    // A huge dt is clamped to a single 100ms step, so nothing teleports.
    p.update(1000);
    expect(p.count).toBe(1);
  });
});

describe('simulation and drawing', () => {
  it('applies gravity and drag without allocating new slots', () => {
    const p = new ParticleSystem(8);
    p.burstConfetti(160, 90, 8);
    const pool = p.poolSize;
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    expect(p.poolSize).toBe(pool);
    expect(p.count).toBeLessThanOrEqual(8);
  });

  it('draws every live particle kind without throwing', () => {
    const p = new ParticleSystem(128);
    p.spawnText(10, 10, '+42 SLOP', { color: C_AMBER, scale: 2, shake: 2 });
    p.spawnMote(20, 20);
    p.burstConfetti(30, 30, 8);
    p.burstShards(40, 40, 8);
    p.burstSparks(50, 50, 8);
    const c = ctx();
    p.update(1 / 60);
    const ops = p.draw(c, 1.234);
    expect(ops).toBeGreaterThan(0);
    expect(() => p.draw(c, 2)).not.toThrow();
  });

  it('restores globalAlpha after drawing', () => {
    const p = new ParticleSystem(32);
    p.burstSparks(10, 10, 20);
    const c = createMockCtx(document.createElement('canvas'));
    c.globalAlpha = 0.5;
    p.draw(c as unknown as CanvasRenderingContext2D, 0.5);
    expect(c.globalAlpha).toBe(0.5);
  });

  it('drawing an empty system is free', () => {
    const p = new ParticleSystem(512);
    const c = createMockCtx(document.createElement('canvas'));
    expect(p.draw(c as unknown as CanvasRenderingContext2D, 0)).toBe(0);
    expect(c.count('fillRect')).toBe(0);
  });

  it('holds a full 800-particle load through a second of simulation', () => {
    const p = new ParticleSystem(1024);
    p.burstConfetti(160, 90, 800);
    expect(p.count).toBe(800);
    const c = ctx();
    for (let f = 0; f < 60; f++) {
      p.update(1 / 60);
      p.draw(c, f / 60);
    }
    expect(p.poolSize).toBe(1024);
    expect(p.count).toBeLessThanOrEqual(1024);
  });
});
