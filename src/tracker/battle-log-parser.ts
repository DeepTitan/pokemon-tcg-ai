import type {
  MatchReview,
  TrackedPlayerBoard,
  TrackedPokemon,
  TrackedTurn,
  TrackerBoardSnapshot,
  TrackerEventKind,
} from './types.js';

const KNOWN_HP: Record<string, number> = {
  Budew: 30,
  Dreepy: 70,
  Drakloak: 90,
  'Dragapult ex': 320,
  Dunsparce: 60,
  Dudunsparce: 140,
  Munkidori: 110,
  'Fezandipiti ex': 210,
  'Meowth ex': 200,
  Slowpoke: 70,
  Slowking: 120,
  'Latias ex': 210,
  'Mega Kangaskhan ex': 300,
  "Lillie's Clefairy ex": 190,
};

let pokemonSequence = 0;

function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/\r\n?/g, '\n').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function cloneSnapshot(snapshot: TrackerBoardSnapshot): TrackerBoardSnapshot {
  return {
    stadium: snapshot.stadium,
    winner: snapshot.winner,
    players: Object.fromEntries(Object.entries(snapshot.players).map(([name, player]) => [
      name,
      {
        ...player,
        active: player.active ? { ...player.active, energies: [...player.active.energies], evolutionStack: [...player.active.evolutionStack] } : null,
        bench: player.bench.map((pokemon) => ({ ...pokemon, energies: [...pokemon.energies], evolutionStack: [...pokemon.evolutionStack] })),
        knownHand: [...player.knownHand],
        discard: [...player.discard],
      },
    ])),
  };
}

function makePokemon(name: string): TrackedPokemon {
  pokemonSequence += 1;
  return {
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${pokemonSequence}`,
    name,
    damage: 0,
    maxHp: KNOWN_HP[name],
    energies: [],
    evolutionStack: [],
  };
}

function emptyPlayer(name: string): TrackedPlayerBoard {
  return {
    name,
    active: null,
    bench: [],
    handCount: 0,
    knownHand: [],
    discard: [],
    prizesTaken: 0,
  };
}

function actorFor(line: string, players: string[]): string | undefined {
  return [...players].sort((a, b) => b.length - a.length).find((name) => (
    line.startsWith(`${name} `) || line.startsWith(`${name}'s `)
  ));
}

function playerForPossessive(text: string, players: string[]): string | undefined {
  return [...players].sort((a, b) => b.length - a.length).find((name) => text.includes(`${name}'s `));
}

function classify(line: string): TrackerEventKind {
  if (/coin toss|opening hand|Active Spot/.test(line)) return 'setup';
  if (/coin flip|flipped (?:heads|tails)/i.test(line)) return 'coin';
  if (/drew|added to .* hand/.test(line)) return 'draw';
  if (/Knocked Out/.test(line)) return 'knockout';
  if (/Prize card|Prize cards|wins\.$/.test(line)) return 'prize';
  if (/damage counter|took \d+ damage|for \d+ damage/.test(line)) return 'damage';
  if (/attached .* Energy|Energy was discarded/.test(line)) return 'energy';
  if (/Stadium spot|was activated/.test(line)) return 'stadium';
  if (/ used /.test(line) && / on .* for \d+ damage/.test(line)) return 'attack';
  if (/ used /.test(line)) return 'ability';
  if (/played .* to the Bench|evolved |retreated /.test(line)) return 'pokemon';
  if (/played /.test(line)) return 'trainer';
  return 'system';
}

function findPokemon(board: TrackedPlayerBoard, name: string): TrackedPokemon | undefined {
  if (board.active?.name === name) return board.active;
  return board.bench.find((pokemon) => pokemon.name === name);
}

function removeKnownCard(board: TrackedPlayerBoard, cardName: string): void {
  const index = board.knownHand.indexOf(cardName);
  if (index >= 0) board.knownHand.splice(index, 1);
  board.handCount = Math.max(0, board.handCount - 1);
}

function putOnBench(board: TrackedPlayerBoard, name: string): void {
  removeKnownCard(board, name);
  board.bench.push(makePokemon(name));
}

function switchToActive(board: TrackedPlayerBoard, name: string): void {
  if (board.active?.name === name) return;
  const benchIndex = board.bench.findIndex((pokemon) => pokemon.name === name);
  const incoming = benchIndex >= 0 ? board.bench.splice(benchIndex, 1)[0] : makePokemon(name);
  if (board.active) board.bench.push(board.active);
  board.active = incoming;
}

function knockOut(board: TrackedPlayerBoard, name: string): void {
  if (board.active?.name === name) {
    board.discard.push(...board.active.evolutionStack, ...board.active.energies, board.active.name);
    board.active = null;
    return;
  }
  const index = board.bench.findIndex((pokemon) => pokemon.name === name);
  if (index >= 0) {
    const [pokemon] = board.bench.splice(index, 1);
    board.discard.push(...pokemon.evolutionStack, ...pokemon.energies, pokemon.name);
  }
}

function addKnownHand(board: TrackedPlayerBoard, cardName: string): void {
  board.handCount += 1;
  board.knownHand.push(cardName);
}

function applyLine(line: string, players: string[], snapshot: TrackerBoardSnapshot): void {
  let match: RegExpMatchArray | null;

  match = line.match(/^(.+?) drew 7 cards for the opening hand\.$/);
  if (match && snapshot.players[match[1]]) {
    snapshot.players[match[1]].handCount = 7;
    return;
  }

  match = line.match(/^(.+?) played (.+?) to the Active Spot\.$/);
  if (match && snapshot.players[match[1]]) {
    removeKnownCard(snapshot.players[match[1]], match[2]);
    snapshot.players[match[1]].active = makePokemon(match[2]);
    return;
  }

  match = line.match(/^(.+?) played (.+?) to the Bench\.$/);
  if (match && snapshot.players[match[1]]) {
    putOnBench(snapshot.players[match[1]], match[2]);
    return;
  }

  match = line.match(/^(.+?)'s (.+?) is now in the Active Spot\.$/);
  if (match && snapshot.players[match[1]]) {
    switchToActive(snapshot.players[match[1]], match[2]);
    return;
  }

  match = line.match(/^(.+?) retreated (.+?) to the Bench\.$/);
  if (match && snapshot.players[match[1]]) {
    const board = snapshot.players[match[1]];
    if (board.active?.name === match[2]) {
      board.bench.push(board.active);
      board.active = null;
    }
    return;
  }

  match = line.match(/^(.+?) evolved (.+?) to (.+?)(?: on the Bench| in the Active Spot)?\.$/);
  if (match && snapshot.players[match[1]]) {
    const board = snapshot.players[match[1]];
    const pokemon = findPokemon(board, match[2]);
    if (pokemon) {
      pokemon.evolutionStack.push(pokemon.name);
      pokemon.name = match[3];
      pokemon.maxHp = KNOWN_HP[match[3]];
    }
    removeKnownCard(board, match[3]);
    return;
  }

  match = line.match(/^(.+?) attached (.+? Energy) to (.+?)(?: on the Bench| in the Active Spot)\.$/);
  if (match && snapshot.players[match[1]]) {
    const board = snapshot.players[match[1]];
    findPokemon(board, match[3])?.energies.push(match[2]);
    removeKnownCard(board, match[2]);
    return;
  }

  match = line.match(/^(.+? Energy) was discarded from (.+?)'s (.+?)\.$/);
  if (match && snapshot.players[match[2]]) {
    const pokemon = findPokemon(snapshot.players[match[2]], match[3]);
    if (pokemon) {
      const energyIndex = pokemon.energies.indexOf(match[1]);
      if (energyIndex >= 0) pokemon.energies.splice(energyIndex, 1);
    }
    snapshot.players[match[2]].discard.push(match[1]);
    return;
  }

  match = line.match(/^(.+?)'s (.+?) was Knocked Out!$/);
  if (match && snapshot.players[match[1]]) {
    knockOut(snapshot.players[match[1]], match[2]);
    return;
  }

  match = line.match(/^(.+?)'s (.+?) took (\d+) damage\.$/);
  if (match && snapshot.players[match[1]]) {
    const pokemon = findPokemon(snapshot.players[match[1]], match[2]);
    if (pokemon) pokemon.damage += Number(match[3]);
    return;
  }

  match = line.match(/put (\d+) damage counters? on (.+?)'s (.+?)\.$/);
  if (match && snapshot.players[match[2]]) {
    const pokemon = findPokemon(snapshot.players[match[2]], match[3]);
    if (pokemon) pokemon.damage += Number(match[1]) * 10;
    return;
  }

  match = line.match(/^(.+?)'s (.+?) used (.+?) on (.+?)'s (.+?) for (\d+) damage/);
  if (match && snapshot.players[match[4]]) {
    const target = findPokemon(snapshot.players[match[4]], match[5]);
    if (target) target.damage += Number(match[6]);
    return;
  }

  match = line.match(/moved (\d+) damage counters? from (.+?)'s (.+?) to (.+?)'s (.+?)\.$/);
  if (match) {
    const amount = Number(match[1]) * 10;
    const source = snapshot.players[match[2]] ? findPokemon(snapshot.players[match[2]], match[3]) : undefined;
    const target = snapshot.players[match[4]] ? findPokemon(snapshot.players[match[4]], match[5]) : undefined;
    if (source) source.damage = Math.max(0, source.damage - amount);
    if (target) target.damage += amount;
    return;
  }

  match = line.match(/^(.+?) took (?:(a)|(\d+)) Prize cards?\.$/);
  if (match && snapshot.players[match[1]]) {
    snapshot.players[match[1]].prizesTaken += Number(match[3] || 1);
    return;
  }

  match = line.match(/^Opponent took all of their Prize cards\. (.+?) wins\.$/);
  if (match) {
    snapshot.winner = match[1];
    return;
  }

  match = line.match(/^(.+?) played (.+?) to the Stadium spot\.$/);
  if (match && snapshot.players[match[1]]) {
    removeKnownCard(snapshot.players[match[1]], match[2]);
    snapshot.stadium = match[2];
    return;
  }

  match = line.match(/^(.+?) discarded (.+?)\.$/);
  if (match && snapshot.players[match[1]] && !/^\d+ cards?$/.test(match[2])) {
    snapshot.players[match[1]].discard.push(match[2]);
    removeKnownCard(snapshot.players[match[1]], match[2]);
    return;
  }

  match = line.match(/^(.+?) drew (?:a card|(.+?))\.$/);
  if (match && snapshot.players[match[1]]) {
    snapshot.players[match[1]].handCount += 1;
    if (match[2]) snapshot.players[match[1]].knownHand.push(match[2]);
    return;
  }

  match = line.match(/^(.+?) was added to (.+?)'s hand\.$/);
  if (match && snapshot.players[match[2]]) {
    addKnownHand(snapshot.players[match[2]], match[1]);
    return;
  }

  match = line.match(/^A card was added to (.+?)'s hand\.$/);
  if (match && snapshot.players[match[1]]) {
    snapshot.players[match[1]].handCount += 1;
    return;
  }

  match = line.match(/^(.+?) played (.+?)\.$/);
  if (match && snapshot.players[match[1]]) {
    removeKnownCard(snapshot.players[match[1]], match[2]);
  }
}

function derivePlayers(log: string): string[] {
  const names: string[] = [];
  for (const line of log.split('\n')) {
    let match = line.match(/^(.+?) chose (?:heads|tails) for the opening coin flip\.$/);
    if (match) names.push(match[1]);
    match = line.match(/^(.+?) drew 7 cards for the opening hand\.$/);
    if (match) names.push(match[1]);
    match = line.match(/^(.+?)'s Turn$/);
    if (match) names.push(match[1]);
  }
  return unique(names).slice(0, 2);
}

export function looksLikeBattleLog(text: string): boolean {
  const log = normalise(text);
  return log.startsWith('Setup\n') && /\n.+?'s Turn\n/.test(log) && /opening (?:coin flip|hand)/.test(log);
}

function reviewId(log: string): string {
  let hash = 2166136261;
  for (let index = 0; index < log.length; index += 1) {
    hash ^= log.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `match-${(hash >>> 0).toString(16)}`;
}

export function parseBattleLog(input: string): MatchReview {
  const log = normalise(input);
  if (!looksLikeBattleLog(log)) throw new Error('This does not look like a Pokémon TCG Live Battle Log export.');

  pokemonSequence = 0;
  const players = derivePlayers(log);
  if (players.length !== 2) throw new Error('Could not identify both players in the Battle Log.');

  const localPlayer = log.match(/^(.+?) chose (?:heads|tails) for the opening coin flip\.$/m)?.[1] || players[0];
  const opponent = players.find((player) => player !== localPlayer) || players[1];
  const snapshot: TrackerBoardSnapshot = {
    players: Object.fromEntries(players.map((player) => [player, emptyPlayer(player)])),
    stadium: null,
  };
  const turns: TrackedTurn[] = [{
    index: 0,
    label: 'Setup',
    events: [],
    snapshot: cloneSnapshot(snapshot),
  }];
  let currentTurn = turns[0];

  for (const rawLine of log.split('\n').slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;
    const turnHeader = line.match(/^(.+?)'s Turn$/);
    if (turnHeader) {
      currentTurn.snapshot = cloneSnapshot(snapshot);
      currentTurn = {
        index: turns.length,
        label: `Turn ${turns.length}`,
        player: turnHeader[1],
        events: [],
        snapshot: cloneSnapshot(snapshot),
      };
      turns.push(currentTurn);
      continue;
    }

    const detail = /^[-•]/.test(line);
    const cleanLine = line.replace(/^[-•]\s*/, '').trim();
    applyLine(cleanLine, players, snapshot);
    const kind = classify(cleanLine);
    currentTurn.events.push({
      id: `${currentTurn.index}-${currentTurn.events.length}`,
      turnIndex: currentTurn.index,
      actor: actorFor(cleanLine, players) || playerForPossessive(cleanLine, players),
      text: cleanLine,
      detail,
      kind,
      coinResult: kind === 'coin'
        ? /heads/i.test(cleanLine) ? 'heads' : /tails/i.test(cleanLine) ? 'tails' : undefined
        : undefined,
    });
    currentTurn.snapshot = cloneSnapshot(snapshot);
  }

  return {
    id: reviewId(log),
    importedAt: new Date().toISOString(),
    source: 'battle-log',
    players,
    localPlayer,
    opponent,
    winner: snapshot.winner,
    turns,
    rawLog: log,
  };
}
