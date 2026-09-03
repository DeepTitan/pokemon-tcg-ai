import type { CardInfo, MatchSummary, TrackedCard, TrackedPlayerBoard, TrackedPokemon } from './types.js';

export interface ArchiveMatchup {
  localCard?: TrackedCard;
  opponentCard?: TrackedCard;
  localPrizesTaken?: number;
  opponentPrizesTaken?: number;
}

interface PokemonCandidate {
  card: TrackedCard;
  count: number;
  highestHp: number;
  inPlayCount: number;
  active: boolean;
  highestEnergyCount: number;
  isRuleBox: boolean;
  hasArt: boolean;
  lineageNames: Set<string>;
}

function cardInfo(card: TrackedCard, catalog: ReadonlyMap<string, CardInfo>): CardInfo | undefined {
  if (!card.cardId) return undefined;
  return catalog.get(card.cardId) || catalog.get(card.cardId.toLowerCase());
}

function displayName(card: TrackedCard, catalog: ReadonlyMap<string, CardInfo>): string {
  return cardInfo(card, catalog)?.name || card.name;
}

function isPokemon(card: TrackedCard, catalog: ReadonlyMap<string, CardInfo>): boolean {
  const info = cardInfo(card, catalog);
  if ('maxHp' in card && typeof (card as TrackedPokemon).maxHp === 'number') return true;
  if (info?.category === 1 || (info?.hp || 0) > 0) return true;
  return Boolean(card.cardType && !/energy$/i.test(displayName(card, catalog)));
}

function candidateHp(card: TrackedCard, catalog: ReadonlyMap<string, CardInfo>): number {
  if ('maxHp' in card) return (card as TrackedPokemon).maxHp || 0;
  return cardInfo(card, catalog)?.hp || 0;
}

function isRuleBoxPokemon(name: string): boolean {
  return /(?:\bex\b|\bV(?:MAX|STAR|-UNION)?\b|\bGX\b|Radiant|BREAK)/i.test(name);
}

function candidateCards(board: TrackedPlayerBoard): Array<{ card: TrackedCard; inPlay: boolean; active: boolean }> {
  return [
    ...(board.active ? [{ card: board.active, inPlay: true, active: true }] : []),
    ...board.bench.map((card) => ({ card, inPlay: true, active: false })),
    ...(board.discardCards || []).map((card) => ({ card, inPlay: false, active: false })),
  ];
}

/** Pick the repeated centerpiece of a deck, rather than a one-off high-HP support Pokemon. */
export function representativePokemon(
  board: TrackedPlayerBoard | undefined,
  catalog: ReadonlyMap<string, CardInfo>,
): TrackedCard | undefined {
  if (!board) return undefined;
  const grouped = new Map<string, PokemonCandidate>();

  for (const { card, inPlay, active } of candidateCards(board)) {
    if (!isPokemon(card, catalog) || /^unknown card$/i.test(card.name)) continue;
    const name = displayName(card, catalog);
    const key = name.trim().toLocaleLowerCase();
    const info = cardInfo(card, catalog);
    const hasArt = Boolean(card.imageDataUrl || info?.imageDataUrl || info?.imagePath);
    const lineageNames = inPlay && 'evolutionStack' in card
      ? (card as TrackedPokemon).evolutionStack.map((lineageName) => lineageName.trim().toLocaleLowerCase())
      : [];
    const energyCount = inPlay && 'energies' in card ? (card as TrackedPokemon).energies.length : 0;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.highestHp = Math.max(existing.highestHp, candidateHp(card, catalog));
      existing.inPlayCount += Number(inPlay);
      existing.active ||= active;
      existing.highestEnergyCount = Math.max(existing.highestEnergyCount, energyCount);
      lineageNames.forEach((lineageName) => existing.lineageNames.add(lineageName));
      if (hasArt && !existing.hasArt) {
        existing.card = card;
        existing.hasArt = true;
      }
      continue;
    }
    grouped.set(key, {
      card,
      count: 1,
      highestHp: candidateHp(card, catalog),
      inPlayCount: Number(inPlay),
      active,
      highestEnergyCount: energyCount,
      isRuleBox: isRuleBoxPokemon(name),
      hasArt,
      lineageNames: new Set(lineageNames),
    });
  }

  const familyCount = (candidate: PokemonCandidate) => candidate.count
    + [...candidate.lineageNames].reduce((total, lineageName) => total + (grouped.get(lineageName)?.count || 0), 0);
  const archetypeScore = (candidate: PokemonCandidate) =>
    familyCount(candidate) * 300
    + candidate.lineageNames.size * 500
    + Number(candidate.isRuleBox) * 350
    + candidate.highestHp * 2
    + candidate.inPlayCount * 50
    + candidate.highestEnergyCount * 100
    + Number(candidate.active) * 100;

  return [...grouped.values()]
    .sort((left, right) =>
      archetypeScore(right) - archetypeScore(left)
      || familyCount(right) - familyCount(left)
      || right.lineageNames.size - left.lineageNames.size
      || right.count - left.count
      || Number(right.isRuleBox) - Number(left.isRuleBox)
      || right.highestHp - left.highestHp
      || right.inPlayCount - left.inPlayCount)
    [0]?.card;
}

export function archiveMatchup(
  summary: MatchSummary,
  catalog: ReadonlyMap<string, CardInfo>,
): ArchiveMatchup {
  const localBoard = summary.finalSnapshot?.players[summary.localPlayer];
  const opponentBoard = summary.finalSnapshot?.players[summary.opponent];
  return {
    localCard: representativePokemon(localBoard, catalog),
    opponentCard: representativePokemon(opponentBoard, catalog),
    localPrizesTaken: localBoard?.prizesKnown === false ? undefined : localBoard?.prizesTaken,
    opponentPrizesTaken: opponentBoard?.prizesKnown === false ? undefined : opponentBoard?.prizesTaken,
  };
}

export function formatMatchDuration(durationSeconds: number | undefined): string {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds < 0) return 'Time —';
  const seconds = Math.round(durationSeconds);
  if (seconds < 60) return `Time ${Math.max(1, seconds)}s`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `Time ${hours}h ${minutes}m` : `Time ${minutes}m`;
}

export function formatPrizeScore(localPrizesTaken: number | undefined, opponentPrizesTaken: number | undefined): string {
  if (localPrizesTaken == null || opponentPrizesTaken == null) return 'Prizes —';
  return `Prizes ${localPrizesTaken}–${opponentPrizesTaken}`;
}
