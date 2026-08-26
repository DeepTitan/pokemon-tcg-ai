import type { TrackedPokemon, TrackedTurn } from './types.js';

export type PokemonBoardPosition = 'active' | 'bench';
export type PokemonPositionChangeCause = 'retreat' | 'promotion' | 'switch';

export interface PokemonPositionChange {
  pokemonId: string;
  pokemonName: string;
  playerName: string;
  from: PokemonBoardPosition;
  to: PokemonBoardPosition;
  cause: PokemonPositionChangeCause;
}

interface PositionedPokemon {
  pokemon: TrackedPokemon;
  playerName: string;
  position: PokemonBoardPosition;
}

function positionedPokemon(turn: TrackedTurn | undefined): PositionedPokemon[] {
  if (!turn) return [];
  return Object.values(turn.snapshot.players).flatMap((player) => [
    ...(player.active ? [{ pokemon: player.active, playerName: player.name, position: 'active' as const }] : []),
    ...player.bench.map((pokemon) => ({ pokemon, playerName: player.name, position: 'bench' as const })),
  ]);
}

function movementCause(turn: TrackedTurn): PokemonPositionChangeCause {
  const action = turn.events.map((event) => event.text).join(' · ');
  if (/\bretreated?\b/i.test(action)) return 'retreat';
  if (/\bpromoted?\b.*\bactive\b|\bto the active spot\b/i.test(action)) return 'promotion';
  return 'switch';
}

export function positionChangesForTurn(previous: TrackedTurn | undefined, current: TrackedTurn | undefined): PokemonPositionChange[] {
  if (!previous || !current) return [];
  const previousById = new Map(positionedPokemon(previous).map((entry) => [entry.pokemon.id, entry]));
  const cause = movementCause(current);
  return positionedPokemon(current).flatMap((entry) => {
    const before = previousById.get(entry.pokemon.id);
    if (!before || before.playerName !== entry.playerName || before.position === entry.position) return [];
    return [{
      pokemonId: entry.pokemon.id,
      pokemonName: entry.pokemon.name,
      playerName: entry.playerName,
      from: before.position,
      to: entry.position,
      cause,
    }];
  });
}
