import type { TrackedPokemon, TrackedTurn } from './types.js';

export interface PokemonDamageChange {
  pokemonId: string;
  pokemonName: string;
  before: number;
  after: number;
  delta: number;
  source: 'board' | 'captured-counter' | 'direct-damage';
}

function pokemonOnBoard(turn: TrackedTurn | undefined): TrackedPokemon[] {
  if (!turn) return [];
  return Object.values(turn.snapshot.players).flatMap((player) => [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ]);
}

type CapturedCounterChange =
  | { kind: 'transition'; name: string; before: number; after: number }
  | { kind: 'marked'; name: string; amount: number };

function capturedCounterChanges(turn: TrackedTurn): CapturedCounterChange[] {
  const seen = new Set<string>();
  return turn.events.flatMap((event) => event.facts || []).flatMap((fact) => {
    if (fact.kind !== 'damage' || !/damage counters/i.test(fact.label)) return [];
    const transition = fact.value.match(/^(.+?):\s*(\d+)\s*→\s*(\d+)\s*damage$/i);
    const marked = fact.value.match(/^(.+?):\s*(\d+)\s*damage marked$/i);
    const change: CapturedCounterChange | undefined = transition
      ? { kind: 'transition', name: transition[1].trim(), before: Number(transition[2]), after: Number(transition[3]) }
      : marked
        ? { kind: 'marked', name: marked[1].trim(), amount: Number(marked[2]) }
        : undefined;
    if (!change) return [];
    const key = change.kind === 'transition'
      ? `${change.kind}|${change.name}|${change.before}|${change.after}`
      : `${change.kind}|${change.name}|${change.amount}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [change];
  });
}

export function damageChangesForTurn(previous: TrackedTurn | undefined, current: TrackedTurn | undefined): PokemonDamageChange[] {
  if (!previous || !current) return [];
  const previousPokemon = pokemonOnBoard(previous);
  const currentPokemon = pokemonOnBoard(current);
  const previousById = new Map(previousPokemon.map((pokemon) => [pokemon.id, pokemon]));
  const currentById = new Map(currentPokemon.map((pokemon) => [pokemon.id, pokemon]));
  const changes = new Map<string, PokemonDamageChange>();

  currentPokemon.forEach((pokemon) => {
    const before = previousById.get(pokemon.id)?.damage;
    if (before == null || before === pokemon.damage) return;
    changes.set(pokemon.id, {
      pokemonId: pokemon.id,
      pokemonName: pokemon.name,
      before,
      after: pokemon.damage,
      delta: pokemon.damage - before,
      source: 'board',
    });
  });

  current.events.filter((event) => event.kind === 'damage').forEach((event) => {
    const match = event.text.match(/dealt\s+(\d+)\s+damage to\s+(.+)$/i);
    if (!match) return;
    const amount = Number(match[1]);
    const targetName = match[2].trim();
    const target = (event.targetEntityId ? currentById.get(event.targetEntityId) : undefined)
      || currentPokemon.find((pokemon) => pokemon.name === targetName && !changes.has(pokemon.id));
    if (!target || changes.has(target.id) || amount <= 0) return;
    const before = previousById.get(target.id)?.damage ?? target.damage;
    changes.set(target.id, {
      pokemonId: target.id,
      pokemonName: target.name,
      before,
      after: before + amount,
      delta: amount,
      source: 'direct-damage',
    });
  });

  const capturedTargets = new Set<string>();
  capturedCounterChanges(current).forEach((counterChange) => {
    if (counterChange.kind === 'transition' && counterChange.before === counterChange.after) return;
    if (counterChange.kind === 'marked' && counterChange.amount <= 0) return;
    const candidates = currentPokemon.filter((pokemon) => (
      pokemon.name === counterChange.name
      && !capturedTargets.has(pokemon.id)
      && !changes.has(pokemon.id)
    ));
    const target = counterChange.kind === 'transition'
      ? candidates.find((pokemon) => previousById.get(pokemon.id)?.damage === counterChange.before && pokemon.damage === counterChange.after)
        || candidates.find((pokemon) => previousById.get(pokemon.id)?.damage === counterChange.before && pokemon.damage === counterChange.before)
        || candidates.find((pokemon) => pokemon.damage === counterChange.before || pokemon.damage === counterChange.after)
      : candidates.find((pokemon) => previousById.has(pokemon.id)) || candidates[0];
    if (!target) return;
    capturedTargets.add(target.id);
    const before = counterChange.kind === 'transition'
      ? counterChange.before
      : previousById.get(target.id)?.damage ?? target.damage;
    const after = counterChange.kind === 'transition'
      ? counterChange.after
      : before + counterChange.amount;
    changes.set(target.id, {
      pokemonId: target.id,
      pokemonName: target.name,
      before,
      after,
      delta: after - before,
      source: 'captured-counter',
    });
  });

  return currentPokemon.flatMap((pokemon) => {
    const change = changes.get(pokemon.id);
    return change ? [change] : [];
  });
}
