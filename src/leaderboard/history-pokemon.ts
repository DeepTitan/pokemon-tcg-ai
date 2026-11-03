import type { HistorySide } from './history.js';

export const EARLY_END_POKEMON_LABEL = 'Match ended before Pokémon were recorded';

// November 2 archive audit: these seven player sides have no captured deck or
// public Pokémon in any frame before the match ended. Scope the explanation to
// that evidence; unrelated missing data must retain the generic fallback.
const endedBeforeRecording: Readonly<Record<string, readonly string[]>> = {
  'live-ee151d421b75475489dd09e23249d72c:f3574161-d7e8-478a-bccf-aaa2ebf5b66c': [
    'name-250057858b2186e815514985', 'name-af600cfe6902a247d8f7c5f0',
  ],
  'live-7937bfcc338047379bff462acf51df9f:3715d646-8a6e-42ce-9dbe-45958ecb6ed1': ['name-3e17194d03c2f0c17d24e50d'],
  'live-857914d9f3e74dd69c289b45e1532a10:75904bc0-312f-48d0-b4f4-a1f62c9c8592': ['name-8969738a9e59572f8e962f13'],
  'live-d508090914d248ad85e5be45180535ee:d4c53e24-728c-49a5-b0f9-957bb8d12c32': ['name-f2940bb68aad3fe3104f2b86'],
  'live-34848812635b4e6b8f17f4d0b2729dcd:2856aee7-2fee-4d73-8366-0d262b018b71': ['name-e8ae37f99e5d0ef2d5c4d907'],
  'live-17fdb50b11424c32af20797187b7d611:05413b96-319a-4dda-aa43-3eb3054bf415': ['name-e8ae37f99e5d0ef2d5c4d907'],
};

export function historyPokemonLabel(matchId: string, playerId: string, side?: HistorySide): string {
  const pokemon = side?.pokemon, name = pokemon?.name?.trim();
  if (name && name !== pokemon?.cardId && name !== pokemon?.artCardId
    && !/^[a-z0-9-]+_\d+(?:_[a-z0-9]+)?$/i.test(name)) return name;
  // Newly recovered Pokémon evidence always takes precedence over the annotation.
  return Object.hasOwn(endedBeforeRecording, matchId) && endedBeforeRecording[matchId].includes(playerId)
    ? EARLY_END_POKEMON_LABEL : 'Pokémon not recorded';
}
