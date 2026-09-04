import type { ReviewEventFact, ReviewSelection, TrackedTurn, TrackerEvent, TrackerEventKind } from './types.js';

const ENERGY_NAMES: Record<string, string> = {
  C: 'Colorless', D: 'Darkness', F: 'Fighting', G: 'Grass', L: 'Lightning',
  M: 'Metal', P: 'Psychic', R: 'Fire', W: 'Water',
};

const HIDDEN_FACT_LABELS = new Set([
  'Operation', 'Player', 'Action', 'Source', 'Target', 'Selection type',
  'Candidate zone', 'Selection', 'Chosen', 'Selection limits', 'Turn state',
  'Choice resolved', 'Effect applied', 'Effect activated', 'Damage calculated',
]);

const FACT_LABELS: Record<string, string> = {
  'Card moved': 'Card moved',
  'Cards moved': 'Cards moved',
  'Cards revealed': 'Cards revealed',
  'Cards drawn': 'Cards drawn',
  'Damage dealt': 'Damage dealt',
  'Damage counters': 'Damage counters',
  'Attack selected': 'Attack',
  'Promoted to Active': 'New Active Pokémon',
  Attached: 'Attached',
  Switched: 'Switched',
  Shuffled: 'Deck shuffled',
  Evolution: 'Evolution',
  'Coin flip': 'Coin flip',
  'Game result': 'Result',
};

const ZONE_NAMES: Record<number, 'deck' | 'discard' | 'hand' | 'bench' | 'active' | 'prize' | 'other'> = {
  7: 'deck', 8: 'deck', 9: 'discard', 10: 'discard', 11: 'hand', 12: 'hand',
  13: 'bench', 14: 'bench', 15: 'active', 16: 'active', 19: 'prize', 20: 'prize',
};

function naturalList(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const compact = [...counts].map(([value, count]) => count > 1 ? `${count} ${value}` : value);
  if (compact.length <= 1) return compact[0] || '';
  if (compact.length === 2) return `${compact[0]} and ${compact[1]}`;
  return `${compact.slice(0, -1).join(', ')}, and ${compact.at(-1)}`;
}

export function humanizeGameTerms(value: string): string {
  return value
    .replace(/\{([A-Z])\}/g, (token, key: string) => ENERGY_NAMES[key] || token)
    .replace(/\bUnknown zone → Unknown zone\b/g, 'a hidden zone → another hidden zone')
    .replace(/\s+/g, ' ')
    .trim();
}

function eventSelectionId(event: TrackerEvent): string | undefined {
  return event.id.includes(':selection:') ? event.id.split(':selection:').at(-1) : undefined;
}

export function selectionForEvent(turn: TrackedTurn, event: TrackerEvent): ReviewSelection | undefined {
  const selectionId = eventSelectionId(event);
  return selectionId ? turn.canonical?.selections.find((candidate) => candidate.id === selectionId) : undefined;
}

function factValues(event: TrackerEvent, label: string): string[] {
  return (event.facts || []).filter((fact) => fact.label === label).map((fact) => humanizeGameTerms(fact.value));
}

function factValue(event: TrackerEvent, label: string): string | undefined {
  return factValues(event, label)[0];
}

function actorPrefix(actor: string | undefined): string {
  return actor ? `${actor}: ` : '';
}

function readableZone(zone: string): string {
  return zone
    .replace(/['’]s Deck$/i, "'s deck")
    .replace(/['’]s Discard$/i, "'s discard pile")
    .replace(/['’]s Hand$/i, "'s hand")
    .replace(/['’]s Bench$/i, "'s Bench")
    .replace(/['’]s Active$/i, "'s Active Spot")
    .replace(/['’]s Prize$/i, "'s Prize cards")
    .replace(/^attached to /i, '');
}

function readableFactValue(label: string, rawValue: string): string {
  const value = humanizeGameTerms(rawValue);

  if (label === 'Card moved' || label === 'Cards moved') {
    const movement = value.match(/^(.+): (.+) → (.+)$/);
    if (movement) return `${movement[1]} moved from ${readableZone(movement[2])} to ${readableZone(movement[3])}`;
  }

  if (label === 'Damage dealt') {
    const damage = value.match(/^(\d+) to (.+)$/);
    if (damage) return `${damage[1]} damage to ${damage[2]}`;
  }

  if (label === 'Damage counters') {
    const damage = value.match(/^(.+): (\d+) damage marked$/i);
    if (damage) return `${damage[2]} damage on ${damage[1]}`;
    const total = value.match(/^(.+): (\d+) → (\d+) damage$/i);
    if (total) return total[2] === total[3]
      ? `${total[1]} has ${total[3]} damage`
      : `${total[1]} now has ${total[3]} damage (was ${total[2]})`;
  }

  if (label === 'Attached') return value.replace(' → ', ' to ');
  if (label === 'Switched') return value.includes(' ↔ ')
    ? value.replace(' ↔ ', ' with ')
    : `${value} moved to the Active Spot`;
  if (label === 'Evolution') return value.replace(' → ', ' into ');
  if (label === 'Game result') return value.replace(' · Opponent conceded', ' because the opponent conceded');

  return value;
}

function selectedNames(selection: ReviewSelection | undefined): string[] {
  if (!selection) return [];
  const selected = new Set(selection.selectedOptionIds);
  return selection.optionCards
    .filter((card) => selected.has(card.id) && card.name && card.name !== 'Unknown card')
    .map((card) => humanizeGameTerms(card.name))
    .slice(0, Math.max(0, selection.maximum));
}

function primaryEvent(turn: TrackedTurn): TrackerEvent | undefined {
  return turn.events.find((event) => !event.detail && !eventSelectionId(event));
}

function actionName(turn: TrackedTurn): string | undefined {
  const primary = primaryEvent(turn);
  const selectedAttack = primary && factValue(primary, 'Attack selected');
  if (selectedAttack) return selectedAttack;
  const used = primary?.text.match(/\bused (.+)$/i)?.[1];
  return used ? humanizeGameTerms(used) : undefined;
}

function sourceName(event: TrackerEvent): string | undefined {
  return factValue(event, 'Source');
}

function namesMovedBetweenZones(event: TrackerEvent, fromZone: string, toZone: string): string[] {
  const matcher = new RegExp(`^(.+): .+['’]s ${fromZone} → .+['’]s ${toZone}$`, 'i');
  return factValues(event, 'Card moved').flatMap((movement) => {
    const match = movement.match(matcher);
    return match ? [match[1]] : [];
  });
}

function selectionSourceLabel(turn: TrackedTurn, event: TrackerEvent): string {
  const primary = primaryEvent(turn);
  if (primary?.kind === 'ability' || factValue(primary || event, 'Attack selected')) {
    return actionName(turn) || sourceName(event) || 'the effect';
  }
  return sourceName(event) || 'the effect';
}

function selectionCopy(turn: TrackedTurn, event: TrackerEvent): string | null {
  const selection = selectionForEvent(turn, event);
  const actor = event.actor || turn.player;
  const prefix = actorPrefix(actor);
  const source = selectionSourceLabel(turn, event);
  const chosen = selectedNames(selection);
  const action = factValue(event, 'Action');
  const switched = factValue(event, 'Switched');
  const attached = factValues(event, 'Attached');
  const promoted = factValues(event, 'Promoted to Active');
  const zones = new Set((selection?.sourceZonePositions || []).map((position) => ZONE_NAMES[position] || 'other'));
  const evolution = factValue(event, 'Evolution');
  const movementValues = factValues(event, 'Card moved');
  const maximum = Math.max(0, selection?.maximum || 0);
  const exactHandDiscards = namesMovedBetweenZones(event, 'Hand', 'Discard')
    .filter((name) => name !== source)
    .slice(0, maximum || undefined);
  const exactDiscardToHand = namesMovedBetweenZones(event, 'Discard', 'Hand')
    .slice(0, maximum || undefined);
  const exactDiscardToDeck = namesMovedBetweenZones(event, 'Discard', 'Deck')
    .slice(0, maximum || undefined);
  const exactDeckToHand = namesMovedBetweenZones(event, 'Deck', 'Hand')
    .filter((name) => name !== source)
    .slice(0, maximum || undefined);
  const exactDeckToBench = namesMovedBetweenZones(event, 'Deck', 'Bench')
    .slice(0, maximum || undefined);
  const chosenMovedToDiscard = chosen.filter((name) => movementValues.some((movement) =>
    movement.startsWith(`${name}: `) && /→ .+['’]s Discard$/i.test(movement)));
  const chosenPromoted = chosen.filter((name) => movementValues.some((movement) =>
    movement.startsWith(`${name}: `) && /['’]s Bench → .+['’]s Active$/i.test(movement)));

  if (promoted.length && /\bpromoted\b/i.test(event.text)) {
    return `${prefix}promoted ${naturalList(promoted)} to the Active Spot`;
  }

  if (selection?.kind === 'text' || selection?.kind === 'unknown') return null;
  if (selection?.kind === 'damage') return null;

  if (selection?.kind === 'reparent') {
    if (!attached.length) return null;
    const attachments = attached.map((value) => value.replace(' → ', ' to '));
    return `${prefix}${source} attached ${naturalList(attachments)}`;
  }

  if (action === 'Retreat') {
    if (!switched?.includes('↔')) return null;
    return `${prefix}switched ${switched.replace(' ↔ ', ' with ')} while retreating`;
  }

  if (switched) return switched.includes('↔')
    ? `${prefix}${source} switched ${switched.replace(' ↔ ', ' with ')}`
    : `${prefix}${source} moved ${switched} to the Active Spot`;

  if (zones.has('prize')) return null;

  if (chosenPromoted.length) {
    return `${prefix}promoted ${naturalList(chosenPromoted)} to the Active Spot`;
  }

  if (evolution && chosen.length) {
    return `${prefix}evolved ${evolution.replace(' → ', ' into ')} with ${source}`;
  }

  if (zones.has('hand') && exactHandDiscards.length) {
    return `${prefix}discarded ${naturalList(exactHandDiscards)} with ${source}`;
  }

  if (chosenMovedToDiscard.length) {
    return `${prefix}discarded ${naturalList(chosenMovedToDiscard)} with ${source}`;
  }

  if (zones.has('discard') && chosen.length) {
    if (exactDiscardToDeck.length) return `${prefix}shuffled ${naturalList(exactDiscardToDeck)} from the discard pile into their deck with ${source}`;
    if (exactDiscardToHand.length) return `${prefix}put ${naturalList(exactDiscardToHand)} from the discard pile into their hand with ${source}`;
    return `${prefix}recovered ${naturalList(chosen)} from the discard pile with ${source}`;
  }

  if (zones.has('deck') && chosen.length) {
    const exact = exactDeckToHand.length ? exactDeckToHand : exactDeckToBench.length ? exactDeckToBench : chosen;
    return `${prefix}searched their deck for ${naturalList(exact)} with ${source}`;
  }

  const primaryKind = primaryEvent(turn)?.kind;
  if (primaryKind === 'trainer' || primaryKind === 'energy') {
    if (exactDeckToBench.length) {
      return `${prefix}put ${naturalList(exactDeckToBench)} onto the Bench from their deck with ${source}`;
    }

    if (exactDeckToHand.length) {
      return `${prefix}searched their deck for ${naturalList(exactDeckToHand)} with ${source}`;
    }
  }

  if (selection?.kind === 'entity' && selection.allOptionIds.length > 6 && selection.eligibleOptionIds.length === 0) {
    return `${prefix}searched their deck with ${source}, but found no valid cards`;
  }

  if (chosen.length) return `${prefix}chose ${naturalList(chosen)} with ${source}`;
  return null;
}

function normalizedPrimary(turn: TrackedTurn, event: TrackerEvent): TrackerEvent | null {
  const actor = event.actor || turn.player;
  const prefix = actorPrefix(actor);
  const source = sourceName(event);
  const action = factValue(event, 'Action');
  const attack = factValue(event, 'Attack selected');
  const text = humanizeGameTerms(event.text);
  const isPrimary = event.id.endsWith(':primary') || event === primaryEvent(turn);

  if (isPrimary && /:\s*retreated\s+/i.test(text)) {
    const exactRetreat = turn.events.some((candidate) => {
      if (!eventSelectionId(candidate)) return false;
      return factValue(candidate, 'Action') === 'Retreat' && Boolean(factValue(candidate, 'Switched')?.includes('↔'));
    });
    if (exactRetreat) return null;
  }

  if (isPrimary && /^Start turn$/i.test(text)) {
    return { ...event, kind: 'setup', text: 'Opening setup completed' };
  }

  if (isPrimary && /\bState update$/i.test(text)) {
    const active = factValues(event, 'Card moved').flatMap((movement) => {
      const match = movement.match(/^(.+): .+['’]s Hand → .+['’]s Active$/i);
      return match ? [match[1]] : [];
    });
    const chosen = active.find((name) => !/^\d+ hidden cards?$/i.test(name));
    return {
      ...event,
      kind: 'setup',
      text: chosen
        ? `${prefix}chose ${chosen} as their Active Pokémon`
        : `${prefix}chose an Active Pokémon`,
    };
  }

  if (isPrimary && (/\bEnd turn$/i.test(text) || action === 'End turn')) {
    return { ...event, kind: 'system', text: `${prefix}ended their turn` };
  }

  if (isPrimary && attack && source) {
    return { ...event, kind: 'attack', text: `${prefix}${source} used ${attack}` };
  }

  if (isPrimary && event.kind === 'attack' && /\bused an attack$/i.test(text) && source) {
    const target = factValue(event, 'Target');
    return { ...event, text: target ? `${prefix}${source} attacked ${target}` : `${prefix}${source} attacked` };
  }

  if (isPrimary && event.kind === 'pokemon' && /:\s*used\s+/i.test(text) && source) {
    const active = factValues(event, 'Card moved').some((movement) =>
      movement.startsWith(`${source}: `) && /['’]s Hand → .+['’]s Active$/i.test(movement));
    if (active) return { ...event, kind: 'setup', text: `${prefix}chose ${source} as their Active Pokémon` };
  }

  if (event.kind === 'draw') {
    const draw = text.match(/—\s*([^—]+ drew \d+ cards?)$/i)?.[1];
    const primary = primaryEvent(turn);
    const used = primary?.text.match(/\bused (.+)$/i)?.[1];
    if (draw && used) return { ...event, text: `${humanizeGameTerms(draw)} with ${humanizeGameTerms(used)}` };
  }

  if (event.kind === 'coin') {
    const result = factValue(event, 'Coin flip');
    if (result && attack) return { ...event, text: `${prefix}${attack} coin flip — ${result}` };
  }

  if (event.kind === 'knockout') {
    const selfKnockout = text.match(/^(.+) was Knocked Out by \1$/i);
    const used = actionName(turn);
    if (selfKnockout && used) return { ...event, text: `${selfKnockout[1]} Knocked itself Out with ${used}` };
  }

  if (event.kind === 'pokemon') {
    const benched = text.match(/^(.+?):\s*Benched\s+(.+)$/i);
    if (benched) return { ...event, text: `${benched[1]}: benched ${benched[2]}` };
  }

  return { ...event, text };
}

export function playerFacingFacts(event: TrackerEvent): ReviewEventFact[] {
  const seen = new Set<string>();
  return (event.facts || []).flatMap((fact) => {
    if (HIDDEN_FACT_LABELS.has(fact.label)) return [];
    if (fact.label === 'Shuffled' && fact.value === 'Cards randomized') return [];
    if (!(fact.label in FACT_LABELS)) return [];
    const label = FACT_LABELS[fact.label];
    const value = readableFactValue(fact.label, fact.value);
    const key = `${label}:${value}`.toLocaleLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [{ ...fact, label, value }];
  });
}

function eventKindForSelection(turn: TrackedTurn, event: TrackerEvent): TrackerEventKind {
  const primary = primaryEvent(turn);
  return primary && primary.kind !== 'system' ? primary.kind : event.kind;
}

/**
 * Converts exact capture events into the concise language used in a Pokémon
 * battle log. Raw operation metadata remains stored on the review; this layer
 * only controls what players see, so old matches improve without reprocessing.
 */
export function presentTurnEvents(turn: TrackedTurn): TrackerEvent[] {
  const seen = new Set<string>();
  return turn.events.flatMap((event) => {
    if (event.detail) return [];
    const selectionId = eventSelectionId(event);
    const copy = selectionId ? selectionCopy(turn, event) : normalizedPrimary(turn, event)?.text || null;
    if (!copy) return [];
    const normalized: TrackerEvent = {
      ...event,
      kind: selectionId ? eventKindForSelection(turn, event) : normalizedPrimary(turn, event)!.kind,
      text: humanizeGameTerms(copy),
      facts: playerFacingFacts(event),
    };
    const key = `${normalized.kind}:${normalized.text}`.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}
