import type { TrackedTurn } from './types.js';

export interface AttackHit {
  targetId?: string;
  target: string;
  damage: number;
  knockedOut: boolean;
}

export interface AttackResolution {
  attacker?: string;
  sourceId?: string;
  source: string;
  attack: string;
  hits: AttackHit[];
  prizeCards: number;
}

function withoutActor(text: string, actor?: string): string {
  if (!actor) return text;
  const escaped = actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^${escaped}:\\s*`, 'i'), '');
}

function knockedOutTarget(event: TrackedTurn['events'][number], actor?: string): { id?: string; name: string } | null {
  if (event.kind !== 'knockout') return null;
  const match = withoutActor(event.text, actor).match(/^(.*?) was Knocked Out(?:\s|$)/i);
  return match?.[1] ? { id: event.targetEntityId, name: match[1].trim() } : null;
}

export function attackResolutionForTurn(turn: TrackedTurn): AttackResolution | null {
  const attackEvent = turn.events.find((event) => event.kind === 'attack');
  const damageEvents = turn.events.filter((event) => event.kind === 'damage');
  if (!attackEvent && !damageEvents.length) return null;

  const attackText = attackEvent ? withoutActor(attackEvent.text, turn.player) : '';
  const attackMatch = attackText.match(/^(.*?) used (.+)$/i);
  const damageMatches = damageEvents.map((event) => ({
    event,
    match: withoutActor(event.text, turn.player).match(/^(.*?) dealt (\d+) damage to (.+)$/i),
  }));
  const firstDamage = damageMatches.find(({ match }) => Boolean(match))?.match;
  const source = attackMatch?.[1]?.trim()
    || turn.choiceCards?.find((card) => card.choiceRole === 'action')?.name
    || 'Attacking Pokémon';
  const attack = attackMatch?.[2]?.trim()
    || firstDamage?.[1]?.trim()
    || turn.choiceLabel?.replace(/^Attacked with\s+/i, '').trim()
    || 'Attack';
  const knockoutTargets = turn.events
    .map((event) => knockedOutTarget(event, turn.player))
    .filter((target): target is { id?: string; name: string } => Boolean(target));
  const matchedKnockouts = new Set<number>();
  const hits: AttackHit[] = damageMatches.flatMap(({ event, match }) => {
    if (!match?.[2] || !match[3]) return [];
    const target = match[3].trim();
    const knockoutIndex = knockoutTargets.findIndex((knockout, index) => !matchedKnockouts.has(index)
      && (event.targetEntityId && knockout.id ? event.targetEntityId === knockout.id : target === knockout.name));
    if (knockoutIndex >= 0) matchedKnockouts.add(knockoutIndex);
    return [{
      ...(event.targetEntityId ? { targetId: event.targetEntityId } : {}),
      target,
      damage: Number(match[2]),
      knockedOut: knockoutIndex >= 0,
    }];
  });
  knockoutTargets.forEach((knockout, index) => {
    if (matchedKnockouts.has(index)) return;
    hits.push({ ...(knockout.id ? { targetId: knockout.id } : {}), target: knockout.name, damage: 0, knockedOut: true });
  });
  const prizeCards = turn.events.reduce((total, event) => {
    if (event.kind !== 'prize') return total;
    const match = event.text.match(/took\s+(\d+)\s+Prize card/i);
    return total + Number(match?.[1] || 0);
  }, 0);

  return { attacker: turn.player, sourceId: attackEvent?.sourceEntityId || turn.choiceCards?.find((card) => card.choiceRole === 'action')?.id, source, attack, hits, prizeCards };
}
