import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { projectPublicLeaderboardSnapshot } from './leaderboard-public-snapshot.js';
import {
  renderSocialMetadata,
  type SocialPreviewMetadata,
} from './leaderboard-social-preview.js';

const staticPath = '/trace/leaderboard-static';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface LeaderboardPages {
  version: 3;
  shell: string;
}

/** The browser and server use the same rating and public-data implementations. */
export function buildLeaderboardRuntime(root = repository) {
  buildSync({
    entryPoints: ['leaderboard-social-preview.ts', 'leaderboard-public-snapshot.ts'].map(filename => path.join(root, 'scripts', filename)),
    outdir: path.join(root, 'landing/lib/generated'), outExtension: { '.js': '.mjs' },
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
  });
}

/** Callback replacement keeps player names containing $& or $` literal. */
export function renderLeaderboardPage(shell: string, metadata: SocialPreviewMetadata): string {
  if (!/<title>[^<]*<\/title>/i.test(shell)) throw new Error('The leaderboard build is missing its page title.');
  return shell
    .replace(/<title>[^<]*<\/title>/i, () => renderSocialMetadata(metadata))
    .replace(/<link\b[^>]*\brel=["']icon["'][^>]*>/i, () => `<link rel="icon" href="${staticPath}/trace-mascot.png">`);
}

/** Prepare local deployment artifacts only; this function makes no network requests.
 * Reapply the recursive public allowlist even though the input was already reviewed.
 * Raw captures, sources, decklists, and diagnostics never enter the static output.
 */
export function buildLeaderboardPages(root = repository): LeaderboardPages {
  const input = path.join(root, 'landing/leaderboard');
  const built = path.join(root, 'dist-leaderboard');
  const output = path.join(root, 'landing/dist/trace/leaderboard-static');
  const previewDirectory = path.join(input, 'previews');
  const snapshot = projectPublicLeaderboardSnapshot(JSON.parse(fs.readFileSync(path.join(input, 'events.json'), 'utf8')));
  const shell = fs.readFileSync(path.join(built, 'leaderboard.html'), 'utf8');
  if (!shell.includes(`${staticPath}/assets/`)) throw new Error(`Build the leaderboard with Vite base ${staticPath}/ first.`);

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const player of snapshot.players) {
    if (!/^[a-zA-Z0-9_-]+$/.test(player.id) || !player.name || ids.has(player.id) || names.has(player.name)) {
      throw new Error('Leaderboard players require unique names and safe, unique IDs.');
    }
    ids.add(player.id);
    names.add(player.name);
  }

  // Keep old image URLs available for messages already shared. New metadata
  // points to the live renderer and does not depend on these screenshots.
  const previewFiles = new Set(fs.readdirSync(previewDirectory).filter(filename => /^[a-zA-Z0-9_-]+\.jpg$/.test(filename)));
  const pages: LeaderboardPages = {
    version: 3,
    shell: shell.replace(/<link\b[^>]*\brel=["']icon["'][^>]*>/i, () => `<link rel="icon" href="${staticPath}/trace-mascot.png">`),
  };

  const artFiles = new Set<string>();
  for (const match of snapshot.matches) {
    for (const side of Object.values(match.history?.players ?? {})) {
      for (const id of [side.pokemon?.artCardId, side.pokemon?.cardId]) {
        if (id && /^[a-zA-Z0-9_-]+$/.test(id) && fs.existsSync(path.join(input, 'card-art', `${id}.png`))) artFiles.add(`${id}.png`);
      }
    }
  }

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  // The live feed owns this URL. Never leave a static snapshot that shadows it.
  fs.cpSync(path.join(built, 'assets'), path.join(output, 'assets'), { recursive: true });
  for (const [directory, files] of [['previews', previewFiles], ['card-art', artFiles]] as const) {
    const destination = path.join(output, directory);
    fs.mkdirSync(destination, { recursive: true });
    for (const filename of files) fs.copyFileSync(path.join(input, directory, filename), path.join(destination, filename));
  }
  for (const filename of ['trace-mascot.png', 'pokemon-card-back.jpg']) {
    fs.copyFileSync(path.join(root, 'public/tracker-assets', filename), path.join(output, filename));
  }
  fs.cpSync(path.join(root, 'landing/training'), path.join(output, 'training'), { recursive: true });
  const pageBundle = path.join(root, 'landing/assets/leaderboard-pages.json.gz');
  fs.mkdirSync(path.dirname(pageBundle), { recursive: true });
  fs.writeFileSync(pageBundle, gzipSync(JSON.stringify(pages), { level: 9 }));
  console.log('Built Trace leaderboard shell. Match data and social previews use the live feed.');
  return pages;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildLeaderboardRuntime();
  if (!process.argv.includes('--runtime-only')) buildLeaderboardPages();
}
