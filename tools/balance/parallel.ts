/**
 * Fan a list of run jobs out over child processes and gather the results.
 *
 * Every job is one seeded game, so the work is embarrassingly parallel. The
 * parent writes the job list to a temp file and spawns `vite-node cli.ts shard`
 * workers (the same loader the test run uses, so the `@sim` alias resolves);
 * each worker plays every n-th job and writes compact results back. With
 * `workers <= 1` everything runs in-process, which is what the unit test uses.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetaState } from '@sim/types.ts';
import type { ClickModel, PolicyId, PolicyOptions } from './policy.ts';
import type { CareerResult } from './meta.ts';
import { career } from './meta.ts';
import type { RunResult } from './run.ts';
import { runOne } from './run.ts';

/** One seeded game to play. `meta` is a full save, so jobs are self-contained. */
export interface Job {
  readonly key: string;
  readonly seed: number;
  readonly policy: PolicyId;
  readonly meta: MetaState;
  readonly metaName: string;
  readonly clicks?: ClickModel;
  readonly policyOptions?: PolicyOptions;
}

/** A RunResult without the heavy fields, small enough to ship between processes. */
export type LiteResult = Omit<RunResult, 'metaAfter' | 'offered' | 'incidentIds' | 'drafted'> & {
  readonly key: string;
};

export function playJob(job: Job): LiteResult {
  const r = runOne({
    seed: job.seed,
    policy: job.policy,
    meta: job.meta,
    metaName: job.metaName,
    ...(job.clicks ? { clicks: job.clicks } : {}),
    ...(job.policyOptions ? { policyOptions: job.policyOptions } : {}),
  });
  const { metaAfter, offered, incidentIds, drafted, ...rest } = r;
  void metaAfter;
  void offered;
  void incidentIds;
  void drafted;
  return { ...rest, key: job.key };
}

/** Worker entry: play every `count`-th job starting at `index`. */
export function runShard(jobFile: string, index: number, count: number, outFile: string): void {
  const jobs = JSON.parse(readFileSync(jobFile, 'utf8')) as Job[];
  const out: LiteResult[] = [];
  for (let i = index; i < jobs.length; i += count) {
    const job = jobs[i];
    if (job) out.push(playJob(job));
  }
  writeFileSync(outFile, JSON.stringify(out), 'utf8');
}

/** Worker entry for careers: play every `count`-th career seed starting at `index`. */
export function runCareerShard(seedFile: string, index: number, count: number, outFile: string): void {
  const list = JSON.parse(readFileSync(seedFile, 'utf8')) as number[];
  const out: CareerResult[] = [];
  for (let i = index; i < list.length; i += count) {
    const seed = list[i];
    if (seed !== undefined) out.push(career({ seed }));
  }
  writeFileSync(outFile, JSON.stringify(out), 'utf8');
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/** Spawn `n` vite-node workers running `cli.ts <mode> <input> <i> <n> <out-i>`. */
async function spawnWorkers(mode: string, input: string, dir: string, n: number): Promise<void> {
  const viteNode = resolve(root, 'node_modules/.bin/vite-node');
  const cli = resolve(here, 'cli.ts');
  await Promise.all(
    Array.from(
      { length: n },
      (_, i) =>
        new Promise<void>((done, fail) => {
          const out = join(dir, `out-${i}.json`);
          const child = spawn(viteNode, [cli, '--', mode, input, String(i), String(n), out], {
            cwd: root,
            stdio: ['ignore', 'ignore', 'inherit'],
          });
          child.on('error', fail);
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`balance ${mode} ${i} exited ${code}`))));
        }),
    ),
  );
}

/** Play whole careers, one per seed, in parallel when `workers > 1`. */
export async function runCareers(seedList: readonly number[], workers: number): Promise<CareerResult[]> {
  if (workers <= 1 || seedList.length < 2) return seedList.map((seed) => career({ seed }));
  const dir = mkdtempSync(join(tmpdir(), 'tm2-career-'));
  try {
    const file = join(dir, 'seeds.json');
    writeFileSync(file, JSON.stringify(seedList), 'utf8');
    const n = Math.min(workers, seedList.length);
    await spawnWorkers('career-shard', file, dir, n);
    const all: CareerResult[] = [];
    for (let i = 0; i < n; i++) all.push(...(JSON.parse(readFileSync(join(dir, `out-${i}.json`), 'utf8')) as CareerResult[]));
    return seedList.map((seed) => {
      const r = all.find((c) => c.seed === seed);
      if (!r) throw new Error(`missing career ${seed}`);
      return r;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Play every job, in parallel when `workers > 1`. Results come back in job order. */
export async function runJobs(jobs: readonly Job[], workers: number): Promise<LiteResult[]> {
  if (workers <= 1 || jobs.length < 4) return jobs.map(playJob);
  const dir = mkdtempSync(join(tmpdir(), 'tm2-balance-'));
  try {
    const jobFile = join(dir, 'jobs.json');
    writeFileSync(jobFile, JSON.stringify(jobs), 'utf8');
    const n = Math.min(workers, jobs.length);
    await spawnWorkers('shard', jobFile, dir, n);
    const byKey = new Map<string, LiteResult[]>();
    for (let i = 0; i < n; i++) {
      for (const r of JSON.parse(readFileSync(join(dir, `out-${i}.json`), 'utf8')) as LiteResult[]) {
        const list = byKey.get(`${r.key}#${r.seed}`) ?? [];
        list.push(r);
        byKey.set(`${r.key}#${r.seed}`, list);
      }
    }
    return jobs.map((j) => {
      const list = byKey.get(`${j.key}#${j.seed}`);
      const r = list?.shift();
      if (!r) throw new Error(`missing result for ${j.key} seed ${j.seed}`);
      return r;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Group results by job key. */
export function byKey(results: readonly LiteResult[]): Map<string, LiteResult[]> {
  const out = new Map<string, LiteResult[]>();
  for (const r of results) {
    const list = out.get(r.key) ?? [];
    list.push(r);
    out.set(r.key, list);
  }
  return out;
}
