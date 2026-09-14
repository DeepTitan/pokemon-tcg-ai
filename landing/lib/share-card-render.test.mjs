import assert from 'node:assert/strict';
import test from 'node:test';
import { socialCardSvg, renderSocialCardPng } from '../api/share-card.mjs';
import { socialCardData } from './share-card-data.mjs';
import { socialMeta, renderShareHtml } from '../api/share-page.mjs';

const markup = (card) => socialCardSvg(card).replace(/href="data:[^"]+"/g, 'href="image-asset"');

const sample = () => socialCardData({ summary: {
  localPlayer: 'isaiahw', opponent: '6TiramiSUI7', winner: 'isaiahw',
  localRating: 1836, opponentRating: 1783, importedAt: '2026-09-14T10:16:21.490Z',
  durationSeconds: 1197, operationCount: 264,
  socialPreview: {
    localCardId: 'sv6_130', localCardName: 'Dragapult ex', localPrizes: 3,
    opponentCardId: 'sv8-5_72', opponentCardName: 'Drakloak', opponentPrizes: 0,
  },
} });

test('head-to-head thumbnail preserves the selected header and inline Elo without the URL or footer', () => {
  const svg = markup(sample());
  for (const fact of ['isaiahw', '6TiramiSUI7', '1836', '1783', 'Dragapult ex', 'Drakloak',
    'VICTORY', '3–0', 'PRIZES TAKEN', 'MATCH REPLAY']) {
    assert.ok(svg.includes(fact), `Missing ${fact}`);
  }
  assert.equal((svg.match(/<image /g) || []).length, 4, 'Backdrop, original mascot, and two real cards');
  assert.equal((svg.match(/>TRACE</g) || []).length, 1);
  assert.match(svg, /<tspan>isaiahw<\/tspan><tspan[^>]*>1836<\/tspan>/);
  assert.match(svg, /<tspan>6TiramiSUI7<\/tspan><tspan[^>]*>1783<\/tspan>/);
  assert.doesNotMatch(svg, /victoryroad\.app|SHARED FROM TRACE|Review the spot|19m|Sep 14|y="615"|<circle|rx=/);
});

test('share metadata uses the updated thumbnail without changing the persistent match URL', () => {
  const meta = socialMeta(sample(), 'existing-share-id', 'https://victoryroad.app');
  assert.equal((meta.match(/https:\/\/victoryroad-lovat\.vercel\.app\/api\/share-card\?shareId=existing-share-id&amp;v=8/g) || []).length, 3);
  assert.match(meta, /property="og:url" content="https:\/\/victoryroad\.app\/trace\/existing-share-id"/);
  assert.match(meta, /rel="canonical" href="https:\/\/victoryroad\.app\/trace\/existing-share-id"/);
  assert.doesNotMatch(meta, /v=[4567]|ratings, duration/);
});

test('preview metadata precedes large inline styles and preserves charset, privacy and canonical URL', () => {
  const shell = '<!doctype html><html><head><meta charset="UTF-8" /><title>Trace</title>'
    + '<meta name="robots" content="noindex, nofollow" /><style>' + ' '.repeat(120_000)
    + '</style></head><body><div id="root"></div></body></html>';
  const html = renderShareHtml(shell, sample(), 'existing-share-id', 'https://victoryroad.app');
  assert.ok(html.indexOf('charset=') < 100);
  assert.ok(html.indexOf('property="og:image"') < 2000);
  assert.ok(html.indexOf('og:image:height') < html.indexOf('<style>'));
  assert.equal((html.match(/property="og:image"/g) || []).length, 1);
  assert.ok(html.includes('noindex, nofollow'));
  assert.ok(html.includes('<div id="root"></div>'));
  assert.ok(html.includes('rel="canonical" href="https://victoryroad.app/trace/existing-share-id"'));
});

test('renders a valid 1200 by 630 PNG even when card artwork is unavailable', () => {
  const png = renderSocialCardPng(sample());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('escapes player text and handles long names and unavailable ratings', () => {
  const card = sample();
  card.localPlayer = 'A&B <player>';
  card.opponent = 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
  card.localRating = undefined;
  card.opponentRating = undefined;
  card.localPokemon.name = "Team Rocket's Extremely Long Pokemon Name";
  const svg = markup(card);
  assert.match(svg, /A&amp;B &lt;player&gt;/);
  assert.match(svg, />M{10,16}…</);
  assert.doesNotMatch(svg, />undefined<|>null<|>NaN<|="NaN"/);
  assert.doesNotThrow(() => renderSocialCardPng(card));
});

test('defeat and incomplete matches keep their actual result', () => {
  for (const [result, color] of [['DEFEAT', '#a13f34'], ['MATCH', '#526277']]) {
    const card = { ...sample(), result, prizeScore: '—' };
    const svg = markup(card);
    assert.match(svg, new RegExp(`fill="${color}"[^>]*>${result}<`));
    assert.doesNotMatch(svg, /VICTORY/);
    if (result === 'MATCH') assert.doesNotMatch(svg, />wins</);
    else assert.match(svg, /<tspan>6TiramiSUI7<\/tspan><tspan[^>]*>wins<\/tspan>/);
    assert.doesNotThrow(() => renderSocialCardPng(card));
  }
});
