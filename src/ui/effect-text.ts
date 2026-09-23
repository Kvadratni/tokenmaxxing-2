/**
 * The Effect vocabulary, in words a player can act on.
 *
 * Every card's blurb is a joke ("Does nothing. The human feels better."), and
 * every card also has a real effect. The draft is a decision, so the card says
 * both: the blurb, then what it actually does ("Patience ×1.12"). Same for
 * upgrades and for the chips in the card strip.
 *
 * This is presentation of the frozen `Effect` union from src/sim/types.ts, not
 * a second copy of any number: every value is read off the definition.
 */
import { TOOL_BY_ID } from '../sim/content.ts';
import type { Effect, InstantAction } from '../sim/types.ts';

function mult(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `×${Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '')}`;
}

function pts(v: number): string {
  const n = Math.round(v * 100);
  return `${n >= 0 ? '+' : '−'}${Math.abs(n)}%`;
}

function toolName(id: string): string {
  return TOOL_BY_ID[id as keyof typeof TOOL_BY_ID]?.name ?? id;
}

/** One effect as a short line, or null for effects with nothing to say. */
export function effectText(e: Effect): string | null {
  switch (e.t) {
    case 'clickMult':
      return `Clicks ${mult(e.v)}`;
    case 'clickAdd':
      return `+${e.v} per click`;
    case 'clickPerTool':
      return `Clicks +${Math.round(e.v * 100)}% per tool owned`;
    case 'idleMult':
      return `Tools ${mult(e.v)}`;
    case 'toolMult':
      return `${toolName(e.id)} ${mult(e.v)}`;
    case 'allMult':
      return `All tokens ${mult(e.v)}`;
    case 'toolCostMult':
      return `Tool prices ${mult(e.v)}`;
    case 'incidentRateMult':
      return `Incidents ${mult(e.v)}`;
    case 'patienceMult':
      return `Patience ${mult(e.v)}`;
    case 'patienceFreeze':
      return 'Patience paused';
    case 'thumbsMult':
      return `👍 ${mult(e.v)}`;
    case 'thumbsPerHonest':
      return `+${e.v} 👍 per honest report`;
    case 'startingTokens':
      return `Start with ${e.v} tokens`;
    case 'startingTool':
      return `Start with ${e.n} ${toolName(e.id)}`;
    case 'draftSize':
      return `${e.v} cards per draft`;
    case 'draftRerolls':
      return `+${e.v} reroll${e.v === 1 ? '' : 's'}`;
    case 'autoClick':
      return `+${e.v} auto-clicks/s`;
    case 'idleHalt':
      return 'Tools stop';
    case 'toolHalt':
      return `${toolName(e.id)} stops`;
    case 'networkHalt':
      return 'Network tools stop';
    case 'critChance':
      return `Crit ${pts(e.v)}`;
    case 'critMult':
      return `Crit payout +${e.v}×`;
    case 'oneShotChance':
      return `One-shot ${pts(e.v)}`;
    case 'oneShotPayout':
      return `One-shot pays +${e.v}s`;
    case 'contextMaxMult':
      return `Context window ${mult(e.v)}`;
    case 'clickContextMult':
      return `Click context ${mult(e.v)}`;
    case 'footprintMult':
      return `Tool footprint ${mult(e.v)}`;
    case 'toolFootprintMult':
      return `${toolName(e.id)} footprint ${mult(e.v)}`;
    case 'floorMult':
      return `MCP manuals ${mult(e.v)}`;
    case 'summarySlots':
      return `+${e.v} summary slot${e.v === 1 ? '' : 's'}`;
    case 'compactKeep':
      return `Compaction keeps ${pts(e.v)} more`;
    case 'compactPenaltyMult':
      return `Compaction penalty ${mult(e.v)}`;
    case 'sycophancyMult':
      return `"Absolutely right" ${mult(e.v)}`;
    case 'verifyChance':
      return `Verify chance ${pts(e.v)}`;
    case 'claimThreshold':
      return `Claim threshold ${pts(e.v)}`;
    case 'caughtPenaltyMult':
      return `Caught penalty ${mult(e.v)}`;
    case 'permissionMult':
      return `Permission prompts ${mult(e.v)}`;
    default:
      return null;
  }
}

/** A one-time lump sum, as a short line. */
export function instantText(a: InstantAction): string | null {
  switch (a.t) {
    case 'context':
      return `${a.ofMax >= 0 ? '+' : '−'}${Math.round(Math.abs(a.ofMax) * 100)}% context now`;
    case 'patience':
      return `${a.ofMax >= 0 ? '+' : '−'}${Math.round(Math.abs(a.ofMax) * 100)}% patience now`;
    case 'tokens':
      return `+${Math.round(a.ofRequirement * 100)}% of the prompt in tokens`;
    case 'loseTokens':
      return `Lose ${Math.round(a.fraction * 100)}% of the wallet`;
    case 'loseTool':
      return 'Lose a tool';
    case 'freeTool':
      return 'A free tool';
    case 'cleanse':
      return 'Clears bad incidents';
    case 'thumbs':
      return `+${a.n} 👍 now`;
    default:
      return null;
  }
}

/** Everything a definition does, joined into one line. */
export function effectsLine(
  effects: readonly Effect[],
  onPick: readonly InstantAction[] = [],
): string {
  const out: string[] = [];
  for (const e of effects) {
    const s = effectText(e);
    if (s !== null) out.push(s);
  }
  for (const a of onPick) {
    const s = instantText(a);
    if (s !== null) out.push(s);
  }
  return out.join(' · ');
}
