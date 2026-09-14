import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { shareCardCatalog } from './lib/share-catalog.mjs';
import { browserCardCatalog } from './lib/replay-card-catalog.mjs';

const landingDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.dirname(landingDirectory);
const outputDirectory = path.join(landingDirectory, 'dist');
const trackerBuildDirectory = path.join(repositoryDirectory, 'dist', 'ui');

// A new texture format must pass framing checks before it reaches production.
execFileSync(process.execPath, ['--test', path.join(landingDirectory, 'lib/share-card-art.test.mjs'), path.join(landingDirectory, 'lib/replay-card-catalog.test.mjs')], { stdio: 'inherit' });

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

const landingFiles = {
  'index.html': 'index.html',
  'styles.css': 'trace-styles.css',
  'script.js': 'trace-script.js',
  'og.png': 'trace-og.png',
  'robots.txt': 'robots.txt',
};
for (const [source, destination] of Object.entries(landingFiles)) {
  fs.copyFileSync(path.join(landingDirectory, source), path.join(outputDirectory, destination));
}
fs.cpSync(path.join(landingDirectory, 'assets'), path.join(outputDirectory, 'trace-assets'), {
  recursive: true,
  filter: (source) => !['share-card-catalog.json.gz', 'share-card-art', 'replay-card-art', 'replay-art-manifest.json'].includes(path.basename(source)),
});

fs.copyFileSync(path.join(trackerBuildDirectory, 'tracker.html'), path.join(outputDirectory, 'shared-replay.html'));
fs.cpSync(path.join(trackerBuildDirectory, 'assets'), path.join(outputDirectory, 'assets'), { recursive: true });
fs.cpSync(path.join(trackerBuildDirectory, 'tracker-assets'), path.join(outputDirectory, 'tracker-assets'), { recursive: true });

const replayArt = JSON.parse(fs.readFileSync(path.join(landingDirectory, 'assets/replay-art-manifest.json'), 'utf8'));
const setDirectory = path.join(outputDirectory, 'tracker-assets/card-catalog');
fs.mkdirSync(setDirectory, { recursive: true });
for (const [set, cards] of browserCardCatalog(shareCardCatalog().values(), replayArt.ids)) {
  fs.writeFileSync(path.join(setDirectory, `${set}.json`), JSON.stringify(cards));
}
fs.cpSync(path.join(landingDirectory, 'assets/replay-card-art'), path.join(outputDirectory, 'tracker-assets/card-art'), { recursive: true });

console.log(`Built Trace landing page and shared replay viewer in ${outputDirectory}`);
