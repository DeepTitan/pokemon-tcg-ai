import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readSqliteReviews, projectLeaderboardReview, buildLeaderboardDataset, type LiveRatingAudit } from '../../scripts/export-trace-leaderboard.js';
import { projectPublicLeaderboardSnapshot } from '../../scripts/leaderboard-public-snapshot.js';
import { createHistoricalEnrichment, projectCloudReview, sourceKeyFor, buildPublicSnapshot, type HistoricalEnrichment } from './projector.js';
import { ACTIVE_ELO_OPTIONS, replayEloRatings } from '../../src/leaderboard/elo.js';
import type { CardInfo } from '../../src/tracker/types.js';

/** A one-time local migration tool. Private reviews/SQLite never enter worker assets. */
export function prepareHistoricalAssets(options: { sqlite: string; cloudDirectory: string; auditFile: string; output: string }) {
  const catalog = new Map<string, CardInfo>();
  const local = readSqliteReviews(options.sqlite, catalog);
  const cards = [...new Map([...catalog.values()].map(card => [card.id, card])).values()].map(card => ({
    id: card.id, name: card.name,
    ...Object.fromEntries(['hp', 'category'].filter(key => typeof card[key as keyof CardInfo] === 'number')
      .map(key => [key, card[key as keyof CardInfo]])),
    ...Object.fromEntries(['cardType', 'evolvesFrom'].filter(key => typeof card[key as keyof CardInfo] === 'string')
      .map(key => [key, card[key as keyof CardInfo]])),
    ...(card.imagePath ? { imagePath: 'available' } : {}),
    ...(card.actions ? { actions: card.actions.map(action => ({ kind: action.kind, name: action.name, text: action.text, cost: action.cost, damage: action.damage })) } : {}),
  })) as CardInfo[];
  const publicCatalog = new Map<string, CardInfo>();
  for (const card of cards) { publicCatalog.set(card.id, card); publicCatalog.set(card.id.toLowerCase(), card); }
  const inputAudit = JSON.parse(fs.readFileSync(options.auditFile, 'utf8')) as LiveRatingAudit;
  const audit: LiveRatingAudit = { matches: {}, playerMetadata: {} };
  for (const key of ['matches', 'playerMetadata'] as const) {
    for (const [id, entry] of Object.entries(inputAudit[key] ?? {})) {
      audit[key]![id] = { observedAt: entry.observedAt,
        players: entry.players.map(player => ({ name: player.name, ...(player.liveRating !== undefined ? { liveRating: player.liveRating } : {}) })),
        ...(entry.liveRatingEligibility ? { liveRatingEligibility: { timing: 'pre-match', valueType: 'elo', evidence: ['Verified historical pregame observation.'] } } : {}),
      };
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(options.cloudDirectory, 'source-manifest.json'), 'utf8'));
  const enrichments: HistoricalEnrichment[] = [];
  const sources = [];
  const cloudInputs = [];
  let pairedLocalSources = 0;
  for (const entry of manifest.files as { path: string }[]) {
    const relative = entry.path;
    const parts = relative.match(/^devices\/([^/]+)\/matches\/([a-f0-9]{64})\.json\.gz$/);
    if (!parts) throw new Error('Unexpected historical source path');
    const review = JSON.parse(gunzipSync(fs.readFileSync(path.join(options.cloudDirectory, relative))).toString('utf8'));
    const sourceKey = sourceKeyFor(parts[1], review.id);
    const cloudProjected = projectLeaderboardReview(review, publicCatalog);
    cloudInputs.push({ review: cloudProjected, sourceLabel: `cloud:${sourceKey}` });
    const own = local.filter(input => input.review.id === review.id && input.review.localPlayer === review.localPlayer && input.review.recording !== true);
    if (own.length > 1) throw new Error('Ambiguous local source enrichment');
    const enrichment = own[0] ? createHistoricalEnrichment(cloudProjected, own[0].review, sourceKey) : undefined;
    if (enrichment) { enrichments.push(enrichment); pairedLocalSources++; }
    sources.push(projectCloudReview({ sourceKey, matchId: review.id, review, catalog: publicCatalog, enrichment }));
  }
  const generatedAt = '2026-09-16T06:19:22.387Z';
  const baseline = projectPublicLeaderboardSnapshot(buildLeaderboardDataset([...local, ...cloudInputs], generatedAt, inputAudit));
  const migrated = buildPublicSnapshot(sources, generatedAt, audit);
  const replay = (snapshot: typeof baseline) => replayEloRatings(snapshot.matches, snapshot.players, ACTIVE_ELO_OPTIONS);
  if (!isDeepStrictEqual(replay(baseline), replay(migrated))) throw new Error('Historical asset migration changes rating replay');
  if (!isDeepStrictEqual(baseline.players, migrated.players)) throw new Error('Historical asset migration changes public player metadata');
  const canonicalHistory = (snapshot: typeof baseline) => snapshot.matches.map(match => ({ id: match.id, history: match.history }));
  if (!isDeepStrictEqual(canonicalHistory(baseline), canonicalHistory(migrated))) throw new Error('Historical asset migration changes public match history');
  fs.mkdirSync(options.output, { recursive: true });
  for (const [filename, value] of [['catalog', cards], ['historical-audit', audit], ['historical-enrichment', enrichments]] as const) {
    fs.writeFileSync(path.join(options.output, `${filename}.json.gz`), gzipSync(JSON.stringify(value)));
  }
  return { cloudSources: sources.length, pairedLocalSources, cards: cards.length, publicPlayers: baseline.players.length,
    completedMatches: baseline.matches.length, ratedMatches: replay(baseline).ratedMatchCount, exactHistoricalReplay: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--sqlite', '--cloud-dir', '--audit', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --sqlite, --cloud-dir, --audit, and --out paths');
    options.set(args[i], args[i + 1]);
  }
  if (options.size !== 4) throw new Error('Expected --sqlite, --cloud-dir, --audit, and --out paths');
  console.log(JSON.stringify(prepareHistoricalAssets({ sqlite: options.get('--sqlite')!, cloudDirectory: options.get('--cloud-dir')!,
    auditFile: options.get('--audit')!, output: options.get('--out')! })));
}
