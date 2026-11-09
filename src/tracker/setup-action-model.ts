import type { TrackerEvent, TrackedTurn } from './types.js';

/** Protocol EndTurn also confirms opening placement. Require exact prize-deal
 * evidence, never an early frame number or the absence of an attack. */
export function normalizeSetupAction(event: TrackerEvent): TrackerEvent {
  if (!event.id.endsWith(':primary')) return event;
  const action = event.facts?.find(fact => fact.label === 'Action')?.value;
  const isEnd = action === 'End turn' || /\bEnd turn$/i.test(event.text);
  if (!isEnd && event.action !== 'setup-complete') return event;
  const movements = new Map<string, number>();
  for (const fact of event.facts ?? []) {
    if (fact.kind !== 'movement') continue;
    const match = fact.value.match(/^(.+): (.+)['’]s Deck → (.+)['’]s Prize$/);
    if (!match || match[2] !== match[3] || match[2] !== event.actor) continue;
    const count = /^(\d+) hidden cards?$/.exec(match[1]);
    movements.set(fact.id, count ? Number(count[1]) : 1);
  }
  const setup = event.action === 'setup-complete'
    || [...movements.values()].reduce((sum, count) => sum + count, 0) === 6;
  if (!setup) return { ...event, action: 'end-turn' };
  return {
    ...event, action: 'setup-complete', kind: 'setup',
    text: `${event.actor ? `${event.actor}: ` : ''}completed setup`,
    facts: event.facts?.map(fact => fact.label === 'Action' ? { ...fact, value: 'Complete setup' } : fact),
  };
}

/** Shared by live reduction, archive loading, and presentation of legacy data. */
export function normalizeSetupTurn(turn: TrackedTurn): TrackedTurn {
  let events = turn.events.map(normalizeSetupAction);
  const setup = events.some(event => event.action === 'setup-complete');
  if (setup) events = events.map(event => ({ ...event, facts: event.facts?.map(fact =>
    fact.label === 'Action' && fact.value === 'End turn' ? { ...fact, value: 'Complete setup' } : fact) }));
  return { ...turn, events, ...(setup ? { label: `Setup · Action ${turn.index}`, choiceLabel: 'Completed setup' } : {}) };
}
