import { DECK_FREQUENCY_BASELINE } from './deck-frequency-baseline.js';
import type { CapturedDecklist, CardInfo, TrackedCard } from './types.js';

export interface DeckFrequencyBaseline {
  version: string;
  deckCount: number;
  /** Number of recorded player decks containing the normalized Pokémon name. */
  deckOccurrences: Readonly<Record<string, number>>;
}

export interface DeckIdentity {
  card?: TrackedCard;
  confidence: 'recognized' | 'ambiguous' | 'fallback' | 'incomplete' | 'unavailable';
  reason: string;
  candidates: { name: string; cardId: string; count: number; score: number; reason: string }[];
  unresolvedCardIds: string[];
  tieBreak?: {
    method: 'deck-frequency';
    baselineVersion: string;
    deckCount: number;
    contenders: { name: string; deckOccurrences: number; surpriseBits: number }[];
  };
}

const key = (value: string) => value.normalize('NFKC').replace(/[’‘]/g, "'").trim().toLowerCase();
interface Candidate { info: CardInfo; count: number; actions: Set<string>; ancestors: string[] }

// Match printed actions, not just species: another printing can have a different role.
const CENTERPIECES: [string, string][] = [
  ['Dragapult ex', 'Phantom Dive'], ['Alakazam', 'Powerful Hand'],
  ["N's Zoroark ex", 'Night Joker'], ['Mega Lucario ex', 'Aura Jab'],
  ['Mega Sharpedo ex', 'Hungry Jaws'], ["Cynthia's Garchomp ex", 'Corkscrew Dive'],
  ["Marnie's Grimmsnarl ex", 'Shadow Bullet'], ["Steven's Metagross ex", 'X-Boot'],
  ['Mega Gardevoir ex', 'Mega Symphonia'], ['Mega Lopunny ex', 'Gale Thrust'],
  ['Mega Darkrai ex', 'Dusk Raid'], ['Mega Absol ex', 'Terminal Period'],
  ['Mega Venusaur ex', 'Jungle Dump'], ['Mega Froslass ex', 'Resentful Refrain'],
  ['Mega Starmie ex', 'Jetting Blow'], ['Mega Excadrill ex', 'Maximum Drilling'],
  ["Team Rocket's Honchkrow", 'Rocket Feathers'],
];
const SUPPORT_ACTIONS = new Set([
  'Flip the Script', 'Last-Ditch Catch', 'Run Away Draw', 'Adrena-Brain', 'Metallic Signal',
  'Boom Boom Groove', 'Wild Growth', 'Cursed Blast', 'Fan Call', 'Skyliner',
].map(key));

/** Pure, order-independent decklist classifier. Never reads game state, prizes or outcomes. */
export function identifyDeck(
  deck: CapturedDecklist | undefined,
  catalog: ReadonlyMap<string, CardInfo>,
  baseline: DeckFrequencyBaseline = DECK_FREQUENCY_BASELINE,
): DeckIdentity {
  const empty = (confidence: DeckIdentity['confidence'], reason: string): DeckIdentity =>
    ({ confidence, reason, candidates: [], unresolvedCardIds: [] });
  if (!deck) return empty('unavailable', 'No captured starting decklist');
  if (deck.source !== 'match-start' || deck.total !== 60 || !Array.isArray(deck.cards)
    || deck.cards.some(c => !c.cardId || !Number.isInteger(c.count) || c.count < 1 || c.count > 60)
    || deck.cards.reduce((n, c) => n + c.count, 0) !== 60
    || new Set(deck.cards.map(c => key(c.cardId))).size !== deck.cards.length) {
    return empty('unavailable', 'Invalid or partial starting decklist');
  }
  const unresolvedCardIds: string[] = [];
  const groups = new Map<string, Candidate>();
  const allCounts = new Map<string, number>();
  for (const entry of [...deck.cards].sort((a, b) => key(a.cardId).localeCompare(key(b.cardId)))) {
    const info = catalog.get(entry.cardId) || catalog.get(entry.cardId.toLowerCase());
    if (!info?.name || ![1, 2, 3].includes(info.category ?? 0)) { unresolvedCardIds.push(entry.cardId); continue; }
    allCounts.set(key(info.name), (allCounts.get(key(info.name)) || 0) + entry.count);
    if (info.category !== 1) continue;
    // Cosmetic prints merge; mechanically different prints remain separate candidates.
    const signature = JSON.stringify([key(info.name), info.hp, key(info.evolvesFrom || ''),
      (info.actions || []).map(a => [a.kind, key(a.name), a.text, a.cost, a.damage])]);
    const existing = groups.get(signature);
    if (existing) existing.count += entry.count;
    else groups.set(signature, { info, count: entry.count,
      actions: new Set((info.actions || []).map(a => key(a.name))), ancestors: [] });
  }
  const mons = [...groups.values()];
  const count = (name: string) => allCounts.get(key(name)) || 0;
  const has = (name: string, action: string, min = 1) => mons.some(c =>
    key(c.info.name) === key(name) && c.actions.has(key(action)) && c.count >= min);
  for (const c of mons) {
    let parent = c.info.evolvesFrom;
    const seen = new Set([key(c.info.name)]);
    while (parent && !seen.has(key(parent)) && count(parent)) {
      c.ancestors.push(parent); seen.add(key(parent));
      parent = mons.find(m => key(m.info.name) === key(parent!))?.info.evolvesFrom;
    }
  }
  const ranked = mons.map(c => {
    const name = c.info.name;
    const is = (n: string, a: string) => key(name) === key(n) && c.actions.has(key(a));
    const parentCopies = c.ancestors.reduce((n, p) => n + count(p), 0);
    const intermediate = mons.some(m => m.ancestors.some(p => key(p) === key(name)));
    const support = [...c.actions].some(a => SUPPORT_ACTIONS.has(a));
    let score = c.count * 100 + Math.min(parentCopies, 8) * 20 + Math.min(c.info.hp || 0, 400) / 20
      + (/\b(ex|V|VMAX|VSTAR|GX)\b/i.test(name) ? 40 : 0)
      - (intermediate ? 600 : 0) - (support ? 450 : 0);
    let matched = false;
    let reason = support ? 'Supporting ability' : intermediate ? 'Pre-evolution of another card in the list' : 'Copies and evolution-line investment';
    const signature = (condition: boolean, description: string, bonus = 1000) => {
      if (condition) { score += bonus; reason = description; matched = true; }
    };
    const establishedLine = c.count >= 2 && (!c.info.evolvesFrom || c.ancestors.length > 0);
    signature(establishedLine && CENTERPIECES.some(([n, a]) => is(n, a)), 'Repeated centerpiece with its printed attack/ability and evolution support');
    signature(is('Dhelmise', 'Vengeful Anchor') && c.count >= 2
      && mons.filter(m => m.actions.has(key("Hide 'n' Sneak"))).reduce((n, m) => n + m.count, 0) >= 4,
    "Vengeful Anchor with a Hide 'n' Sneak discard engine", 1600);
    signature(is('Slowking', 'Seek Inspiration') && establishedLine && count('Academy at Night') >= 2,
      'Seek Inspiration with Academy at Night and an evolution line', 1600);
    signature(is('Crustle', 'Mysterious Rock Inn') && establishedLine,
      'Repeated Crustle wall and Dwebble line; Kangaskhan supplies draw', 1600);
    signature(is("Team Rocket's Mewtwo ex", 'Erasure Ball') && count("Team Rocket's Spidops") >= 3
      && has("Team Rocket's Spidops", 'Charging Up'), 'Erasure Ball powered by the Spidops energy engine', 1600);
    signature(!intermediate && c.actions.has(key('Festival Lead')) && c.count >= 2 && count('Festival Grounds') >= 2
      && has('Thwackey', 'Boom Boom Groove'), 'Festival Lead attacker with Festival Grounds and Thwackey', 1600);
    signature(is('Teal Mask Ogerpon ex', 'Teal Dance') && c.count >= 3 && has('Meganium', 'Wild Growth')
      && !has('Mega Venusaur ex', 'Jungle Dump', 2), 'Teal Dance and Wild Growth energy-scaling core', 1600);
    signature(is('Teal Mask Ogerpon ex', 'Teal Dance') && c.count >= 2 && count("Lillie's Clefairy ex") >= 1
      && count('Area Zero Underdepths') >= 2 && (count('Crispin') >= 2 || c.count >= 3)
      && !mons.some(m => m.ancestors.length > 0), 'Basic toolbox: Ogerpon energy engine, Clefairy and Area Zero', 1600);
    const control = count('Elgyem') >= 2 && has('Elgyem', 'Slight Shift')
      && has('Wellspring Mask Ogerpon ex', 'Sob', 2)
      && ['Rust Syndicate Grunt', 'Crushing Hammer', 'Eri', "Xerosic's Machinations"].reduce((n, p) => n + count(p), 0) >= 4
      && !mons.some(m => m.count >= 2 && m.ancestors.length > 0);
    signature(control && (is('Elgyem', 'Slight Shift') || is('Wellspring Mask Ogerpon ex', 'Sob')),
      'Control toolbox: energy displacement, retreat lock and disruption Trainers', 1600);
    return { c, matched, control, name, cardId: c.info.id, count: c.count, score, reason };
  }).sort((a, b) => b.score - a.score || key(a.name).localeCompare(key(b.name)) || a.cardId.localeCompare(b.cardId));
  let first = ranked[0];
  if (!first) return { ...empty(unresolvedCardIds.length ? 'incomplete' : 'unavailable', 'No resolved Pokémon in the starting decklist'), unresolvedCardIds };
  // Surprisal is a tiebreak between established centerpieces only. A rare tech,
  // support card or pre-evolution cannot enter the shortlist through rarity.
  const contenders = ranked.filter((c, i) => first.matched && c.matched && first.score - c.score < 150
    && ranked.findIndex(other => key(other.name) === key(c.name)) === i);
  let tieBreak: DeckIdentity['tieBreak'];
  if (contenders.length > 1 && Number.isInteger(baseline.deckCount) && baseline.deckCount > 0) {
    const frequencies = contenders.map(c => ({ name: c.name, deckOccurrences: baseline.deckOccurrences[key(c.name)] }));
    // Missing observations are uncertainty, not proof that a card is rare.
    if (frequencies.every(c => Number.isInteger(c.deckOccurrences) && c.deckOccurrences > 0 && c.deckOccurrences <= baseline.deckCount)) {
      frequencies.sort((a, b) => a.deckOccurrences - b.deckOccurrences || key(a.name).localeCompare(key(b.name)));
      if (frequencies[0].deckOccurrences < frequencies[1].deckOccurrences) {
        first = contenders.find(c => c.name === frequencies[0].name)!;
        tieBreak = { method: 'deck-frequency', baselineVersion: baseline.version, deckCount: baseline.deckCount,
          contenders: frequencies.map(c => ({ ...c, surpriseBits: Math.log2((baseline.deckCount + 1) / (c.deckOccurrences + 1)) })) };
      }
    }
  }
  const recognized = first.matched;
  const ambiguous = contenders.length > 1 && !tieBreak;
  const ordered = [first, ...ranked.filter(c => c !== first)];
  return {
    card: { id: `deck:${first.cardId}`, cardId: first.cardId, name: first.name,
      cardType: first.c.info.cardType, imageDataUrl: first.c.info.imageDataUrl },
    confidence: unresolvedCardIds.length ? 'incomplete' : ambiguous ? 'ambiguous' : recognized ? 'recognized' : 'fallback',
    reason: tieBreak
      ? `${first.reason}; frequency tiebreak: ${first.name} appears in ${tieBreak.contenders[0].deckOccurrences}/${tieBreak.deckCount} recorded decks`
      : first.reason,
    ...(tieBreak ? { tieBreak } : {}),
    candidates: ordered.map(({ c: _c, matched: _matched, control: _control, ...item }) => item), unresolvedCardIds,
  };
}
