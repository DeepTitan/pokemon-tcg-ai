import type { TrackedTurn, TrackerEvent } from './types.js';

export type TurnPassReason = 'passed' | 'timeout';

export interface TurnPass {
  passer: string;
  receiver?: string;
  reason: TurnPassReason;
}

function actionFact(event: TrackerEvent): string | undefined {
  return event.facts?.find((fact) => fact.label === 'Action')?.value;
}

function actorFromText(text: string, players: readonly string[]): string | undefined {
  return [...players]
    .sort((left, right) => right.length - left.length)
    .find((player) => text.startsWith(`${player}:`) || text.startsWith(`${player} `) || text.startsWith(`${player}'s `));
}

function passReason(event: TrackerEvent): TurnPassReason | null {
  const action = actionFact(event)?.trim() || '';
  const copy = event.text.trim();

  if (/^(?:Timeout|End turn timeout)$/i.test(action) || /\b(?:timed out|end turn timeout)$/i.test(copy)) {
    return 'timeout';
  }
  if (/^End turn$/i.test(action) || /\bEnd turn$/i.test(copy) || /\bended their turn$/i.test(copy)) {
    return 'passed';
  }
  return null;
}

/**
 * An explicit End turn operation means the player chose to finish without an
 * attack. Attacks end their own turn and therefore must not become pass cues.
 * Text fallbacks retain support for reviews saved before readable log copy was
 * introduced.
 */
export function turnPassForTurn(turn: TrackedTurn, players: readonly string[]): TurnPass | null {
  if (turn.events.some((event) => event.kind === 'attack')) return null;

  for (const event of turn.events) {
    const reason = passReason(event);
    if (!reason) continue;
    const passer = event.actor || turn.player || actorFromText(event.text, players);
    if (!passer) return null;
    return {
      passer,
      receiver: players.find((player) => player !== passer),
      reason,
    };
  }
  return null;
}
