import https from 'node:https';

const TRACE_API_URL = 'https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finalSnapshot(review) {
  const turns = asArray(review?.turns);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const snapshot = asObject(turns[index]?.snapshot);
    if (Object.keys(asObject(snapshot.players)).length) return snapshot;
  }
  return { players: {} };
}

function candidateCards(board) {
  const value = asObject(board);
  return [
    ...(value.active ? [{ card: value.active, active: true, inPlay: true }] : []),
    ...asArray(value.bench).map((card) => ({ card, active: false, inPlay: true })),
    ...asArray(value.discardCards).map((card) => ({ card, active: false, inPlay: false })),
  ];
}

function isPokemon(card) {
  const value = asObject(card);
  const name = typeof value.name === 'string' ? value.name : '';
  return !/^unknown card$/i.test(name)
    && !/energy$/i.test(name)
    && (finiteNumber(value.maxHp) != null || (typeof value.cardType === 'string' && value.cardType.length > 0));
}

function isRuleBoxPokemon(name) {
  return /(?:\bex\b|\bV(?:MAX|STAR|-UNION)?\b|\bGX\b|Radiant|BREAK)/i.test(name);
}

/** Mirrors Trace's archive-card selection without requiring the desktop catalog. */
export function representativePokemon(board) {
  const grouped = new Map();
  for (const entry of candidateCards(board)) {
    const card = asObject(entry.card);
    if (!isPokemon(card)) continue;
    const name = String(card.name || 'Unknown deck').trim();
    const key = name.toLocaleLowerCase();
    const lineages = entry.inPlay ? asArray(card.evolutionStack)
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().toLocaleLowerCase()) : [];
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.highestHp = Math.max(existing.highestHp, finiteNumber(card.maxHp) || 0);
      existing.inPlayCount += Number(entry.inPlay);
      existing.active ||= entry.active;
      existing.highestEnergyCount = Math.max(existing.highestEnergyCount, asArray(card.energies).length);
      lineages.forEach((lineage) => existing.lineageNames.add(lineage));
      if (!existing.card.cardId && card.cardId) existing.card = card;
      continue;
    }
    grouped.set(key, {
      card,
      count: 1,
      highestHp: finiteNumber(card.maxHp) || 0,
      inPlayCount: Number(entry.inPlay),
      active: entry.active,
      highestEnergyCount: asArray(card.energies).length,
      isRuleBox: isRuleBoxPokemon(name),
      lineageNames: new Set(lineages),
    });
  }

  const familyCount = (candidate) => candidate.count
    + [...candidate.lineageNames].reduce((total, lineage) => total + (grouped.get(lineage)?.count || 0), 0);
  const score = (candidate) => familyCount(candidate) * 300
    + candidate.lineageNames.size * 500
    + Number(candidate.isRuleBox) * 350
    + candidate.highestHp * 2
    + candidate.inPlayCount * 50
    + candidate.highestEnergyCount * 100
    + Number(candidate.active) * 100;

  return [...grouped.values()].sort((left, right) =>
    score(right) - score(left)
    || familyCount(right) - familyCount(left)
    || right.count - left.count
    || Number(right.isRuleBox) - Number(left.isRuleBox)
    || right.highestHp - left.highestHp)[0]?.card;
}

export function publicCardArtUrl(cardId) {
  if (typeof cardId !== 'string') return undefined;
  const [rawSet, rawNumber] = cardId.toLowerCase().split('_');
  const number = rawNumber?.match(/^\d+/)?.[0];
  if (!rawSet || !number) return undefined;
  const set = rawSet.replace(/-(\d+)$/, 'pt$1');
  return `https://images.pokemontcg.io/${set}/${Number(number)}.png`;
}

function formatDate(iso) {
  const value = new Date(iso);
  if (Number.isNaN(value.valueOf())) return 'Match replay';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
  }).formatToParts(value);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.month} ${lookup.day} · ${lookup.hour}:${lookup.minute} ${lookup.dayPeriod} ${lookup.timeZoneName}`;
}

function formatDuration(seconds) {
  if (finiteNumber(seconds) == null || seconds < 0) return undefined;
  const wholeSeconds = Math.round(seconds);
  if (wholeSeconds < 60) return `${Math.max(1, wholeSeconds)}s`;
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function socialCardData(payload) {
  const review = asObject(payload?.review);
  const summary = asObject(payload?.summary);
  const localPlayer = String(review.localPlayer || summary.localPlayer || 'You');
  const opponent = String(review.opponent || summary.opponent || 'Opponent');
  const winner = typeof review.winner === 'string' ? review.winner
    : typeof summary.winner === 'string' ? summary.winner : undefined;
  const snapshot = finalSnapshot(review);
  const players = asObject(snapshot.players);
  const localBoard = asObject(players[localPlayer]);
  const opponentBoard = asObject(players[opponent]);
  const preview = asObject(summary.socialPreview);
  const localPokemon = representativePokemon(localBoard) || {
    name: preview.localCardName,
    cardId: preview.localCardId,
  };
  const opponentPokemon = representativePokemon(opponentBoard) || {
    name: preview.opponentCardName,
    cardId: preview.opponentCardId,
  };
  const localPrizes = finiteNumber(localBoard.prizesTaken) ?? finiteNumber(preview.localPrizes);
  const opponentPrizes = finiteNumber(opponentBoard.prizesTaken) ?? finiteNumber(preview.opponentPrizes);
  const result = winner ? (winner === localPlayer ? 'VICTORY' : 'DEFEAT') : 'MATCH';
  const localName = String(localPokemon?.name || 'Unknown deck');
  const opponentName = String(opponentPokemon?.name || 'Unknown deck');
  const prizeScore = localPrizes != null && opponentPrizes != null
    ? `${localPrizes}–${opponentPrizes}` : '—';
  const localRating = finiteNumber(review.localRating) ?? finiteNumber(summary.localRating);
  const opponentRating = finiteNumber(review.opponentRating) ?? finiteNumber(summary.opponentRating);
  const duration = formatDuration(finiteNumber(summary.durationSeconds) ?? finiteNumber(review.durationSeconds));
  const date = formatDate(review.importedAt || summary.importedAt);
  const title = `${localPlayer} vs. ${opponent}`;
  const resultVerb = result === 'VICTORY' ? 'defeated' : result === 'DEFEAT' ? 'played' : 'played';

  return {
    title,
    description: `${localPlayer} ${resultVerb} ${opponent}. ${localName} vs. ${opponentName} · ${prizeScore} prizes. Review the full match on Trace.`,
    result,
    localPlayer,
    opponent,
    localRating,
    opponentRating,
    localPokemon: {
      name: localName,
      image: publicCardArtUrl(localPokemon?.cardId),
    },
    opponentPokemon: {
      name: opponentName,
      image: publicCardArtUrl(opponentPokemon?.cardId),
    },
    date,
    duration,
    prizeScore,
    actionCount: finiteNumber(summary.operationCount) ?? asArray(review.turns).length,
  };
}

export async function fetchSharedReplay(shareId, signal, summaryOnly = false) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(shareId || '')) {
    const error = new Error('Invalid share id');
    error.status = 400;
    throw error;
  }
  const suffix = summaryOnly ? '?summary=1' : '';
  const url = `${TRACE_API_URL}/v1/shares/${encodeURIComponent(shareId)}${suffix}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => request.destroy(new Error('Shared replay request timed out'));
    const request = https.get(url, { headers: { accept: 'application/json', connection: 'close' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', (error) => finish(reject, error));
      response.on('end', () => {
        const status = response.statusCode || 500;
        if (status < 200 || status >= 300) {
          const error = new Error(status === 404 ? 'Shared replay not found' : 'Shared replay unavailable');
          error.status = status;
          finish(reject, error);
          return;
        }
        try {
          finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          finish(reject, new Error('Shared replay returned invalid data'));
        }
      });
    });
    request.setTimeout(8_000, abort);
    request.on('error', (error) => finish(reject, error));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export function requestShareId(request) {
  const queryValue = request?.query?.shareId;
  if (typeof queryValue === 'string') return queryValue;
  if (Array.isArray(queryValue)) return queryValue[0] || '';
  try {
    return new URL(request.url, 'https://victoryroad.app').searchParams.get('shareId') || '';
  } catch {
    return '';
  }
}
