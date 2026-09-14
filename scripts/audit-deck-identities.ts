import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { identifyDeck } from '../src/tracker/deck-identity.js';
import { representativePokemon } from '../src/tracker/archive-summary-model.js';
import { capturedDecklists } from '../src/tracker/captured-decklists.js';
import type { CapturedDecklist, CardInfo, MatchSummary } from '../src/tracker/types.js';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const fixture = JSON.parse(fs.readFileSync(new URL('../src/tracker/__tests__/fixtures/deck-identity-corpus.json', import.meta.url), 'utf8'));
const inventoryKey = (cards: CapturedDecklist['cards']) => JSON.stringify(cards.map(c => [c.cardId.toLowerCase(), c.count]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
const labels = new Map<string, any>(fixture.cases.map((c: any) => [inventoryKey(c.cards), c]));
const database = arg('--database');
const input = arg('--corpus');
const output = path.resolve(arg('--output') || 'data/experiments/deck-identity-audit.json');
let cards: CardInfo[] = fixture.cards;
let matches: { id: string; summary: MatchSummary; decklists: CapturedDecklist[] }[];
if (database) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-deck-audit-'));
  try {
    // Copy a stable database/WAL pair; never open SQLite against the live application files.
    const result = spawnSync('python3', ['-', path.resolve(database), temp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input: `
import sys, sqlite3, pathlib, gzip, json, shutil
root=pathlib.Path(sys.argv[2])
source=pathlib.Path(sys.argv[1])
files=[source,pathlib.Path(str(source)+'-wal')]
def stamps():
 return [(f.stat().st_size,f.stat().st_mtime_ns) if f.exists() else None for f in files]
for attempt in range(4):
 before=stamps()
 for f,suffix in zip(files,['','-wal']):
  dest=root/('snapshot.sqlite3'+suffix)
  if f.exists(): shutil.copyfile(f,dest)
  elif dest.exists(): dest.unlink()
 if before==stamps(): break
else: raise RuntimeError('Database changed while copying; retry the audit against a stable snapshot')
c=sqlite3.connect(str(root/'snapshot.sqlite3'))
rows=[]
for id,summary,review in c.execute('SELECT id,summary_json,review_gzip FROM matches ORDER BY imported_at,id'):
 r=json.loads(gzip.decompress(review)) if review else {}
 lists=r.get('decklists',[])
 starts=[]
 if len(lists)<2:
  for (payload,) in c.execute('SELECT payload_gzip FROM operations WHERE match_id=? ORDER BY id',(id,)):
   op=json.loads(gzip.decompress(payload)).get('operation')
   if isinstance(op,dict) and any(isinstance(p.get('deckInfo'),dict) and p['deckInfo'].get('cards') for p in op.get('players',[])):
    starts.append(op)
 rows.append(dict(id=id,summary=json.loads(summary) if summary else {},decklists=lists,starts=starts))
cards=[json.loads(v) for (v,) in c.execute('SELECT payload_json FROM cards')]
for card in cards:
 card.pop('imageDataUrl',None);card.pop('imagePath',None)
(root/'corpus.json').write_text(json.dumps(dict(matches=rows,cards=cards)))
` });
    if (result.status !== 0) throw new Error(result.stderr || 'Snapshot export failed');
    const corpus = JSON.parse(fs.readFileSync(path.join(temp, 'corpus.json'), 'utf8'));
    cards = corpus.cards;
    matches = corpus.matches.map((m: any) => {
      const lists = new Map(m.decklists.map((d: CapturedDecklist) => [d.playerName, d]));
      for (const operation of m.starts) for (const d of capturedDecklists(operation)) if (!lists.has(d.playerName)) lists.set(d.playerName, d);
      return { id: m.id, summary: m.summary, decklists: [...lists.values()] };
    });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
} else if (input) {
  matches = JSON.parse(fs.readFileSync(input, 'utf8'));
  cards = JSON.parse(fs.readFileSync(path.join(path.dirname(input), 'cards.json'), 'utf8'));
} else {
  matches = fixture.cases.map((c: any) => ({ id: c.id, summary: { localPlayer: 'Player' } as MatchSummary,
    decklists: [{ playerName: 'Player', playerId: 'p1', source: 'match-start', total: 60, cards: c.cards }] }));
}
const catalog = new Map(cards.map(c => [c.id, c]));
const rows = matches.flatMap((m, index) => {
  const players = new Set([m.summary.localPlayer, m.summary.opponent, ...m.decklists.map(d => d.playerName)].filter(Boolean));
  if (!players.size) players.add('Unknown');
  return [...players].map(player => {
    const deck = m.decklists.find(d => d.playerName === player);
    const identity = identifyDeck(deck, catalog);
    const reviewed = deck ? labels.get(inventoryKey(deck.cards)) : undefined;
    const oldCard = representativePokemon(m.summary.finalSnapshot?.players[player], catalog);
    const old = (oldCard?.cardId ? catalog.get(oldCard.cardId)?.name || catalog.get(oldCard.cardId.toLowerCase())?.name : undefined) || oldCard?.name;
    return { game: index + 1, match: createHash('sha256').update(m.id).digest('hex').slice(0, 12),
      side: player === m.summary.localPlayer ? 'local' : 'opponent', deckCase: reviewed?.id,
      previous: old, selected: identity.card?.name, expected: reviewed?.expected,
      status: !deck ? 'missing-decklist' : !reviewed ? 'unreviewed' : identity.card?.name !== reviewed.expected ? 'mismatch' : 'match',
      confidence: identity.confidence, tieBreak: identity.tieBreak, reason: identity.reason, unresolvedCardIds: identity.unresolvedCardIds,
      candidates: identity.candidates.slice(0, 4) };
  });
});
const report = { generatedAt: new Date().toISOString(), games: matches.length, sides: rows.length,
  completeDeckSides: rows.filter(r => r.status !== 'missing-decklist').length,
  reviewedExactDecklists: new Set(rows.map(r => r.deckCase).filter(Boolean)).size,
  matchesReviewedLabel: rows.filter(r => r.status === 'match').length,
  mismatches: rows.filter(r => r.status === 'mismatch').length,
  unreviewed: rows.filter(r => r.status === 'unreviewed').length,
  missingDecklists: rows.filter(r => r.status === 'missing-decklist').length,
  incompleteMetadata: rows.filter(r => r.confidence === 'incomplete').length,
  frequencyTieBreaks: rows.filter(r => r.tieBreak).length,
  ambiguous: rows.filter(r => r.confidence === 'ambiguous').length,
  changedSelections: rows.filter(r => r.selected && r.previous !== r.selected).length,
  previousMismatches: rows.filter(r => r.expected && r.previous !== r.expected).length,
  rows };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(output.replace(/\.json$/, '') + '.md', `# Deck identity audit\n\n${report.games} games; ${report.completeDeckSides} complete deck sides; ${report.reviewedExactDecklists} reviewed exact lists.\n\n${report.matchesReviewedLabel} match reviewed labels; ${report.mismatches} mismatches; ${report.unreviewed} unreviewed; ${report.missingDecklists} missing lists; ${report.frequencyTieBreaks} frequency tiebreaks; ${report.ambiguous} unresolved ambiguous selections.\n\nReviewed labels are a regression baseline, not independent accuracy on unseen decks.\n\n| Game | Side | Previous | Decklist selection | Status | Confidence |\n|---|---|---|---|---|---|\n` + rows.map(r => `| ${r.game} (${r.match}) | ${r.side} | ${r.previous || '—'} | ${r.selected || '—'} | ${r.status} | ${r.confidence} |`).join('\n') + '\n');
const { rows: _rows, ...summary } = report;
console.log(JSON.stringify({ ...summary, output }, null, 2));
if (report.mismatches || report.unreviewed || report.incompleteMetadata) process.exitCode = 1;
