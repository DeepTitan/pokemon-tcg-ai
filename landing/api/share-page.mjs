import {
  fetchSharedReplay,
  requestShareId,
  socialCardData,
} from '../lib/share-card-data.mjs';

const VIEWER_ORIGIN = process.env.TRACE_VIEWER_ORIGIN || 'https://victoryroad-lovat.vercel.app';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function deploymentOrigin(request) {
  const fallback = 'https://victoryroad.app';
  const rawHost = request.headers?.['x-forwarded-host'] || request.headers?.host;
  const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+(?::\d{2,5})?$/.test(host)) return fallback;
  const protocol = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function socialMeta(card, shareId, origin) {
  const title = escapeHtml(`${card.title} — Trace match replay`);
  const description = escapeHtml(card.description);
  const url = `${origin}/trace/${encodeURIComponent(shareId)}`;
  const image = `${origin}/api/share-card?shareId=${encodeURIComponent(shareId)}&v=5`;
  return [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:secure_url" content="${escapeHtml(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:type" content="image/png" />',
    '<meta property="og:image:alt" content="Trace match summary with both featured Pokémon, player names, ratings, result, and prize score" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
  ].join('\n    ');
}

export default async function handler(request, response) {
  const shareId = requestShareId(request);
  const origin = deploymentOrigin(request);
  try {
    const [payload, shellResponse] = await Promise.all([
      fetchSharedReplay(shareId, AbortSignal.timeout(8_000), true),
      fetch(`${VIEWER_ORIGIN}/shared-replay`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(8_000),
      }),
    ]);
    if (!shellResponse.ok) throw new Error('Replay viewer is temporarily unavailable');
    const card = socialCardData(payload);
    let html = await shellResponse.text();
    html = html
      .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(card.title)} — Trace match replay</title>`)
      .replace('</head>', `    ${socialMeta(card, shareId, origin)}\n  </head>`);
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('cache-control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    response.setHeader('x-content-type-options', 'nosniff');
    response.end(html);
  } catch (error) {
    response.statusCode = Number(error?.status) || 500;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Trace shared replay</title></head><body><main><h1>This match could not be opened.</h1><p>${escapeHtml(error instanceof Error ? error.message : 'Please try again shortly.')}</p><a href="/trace">Return to Trace</a></main></body></html>`);
  }
}
