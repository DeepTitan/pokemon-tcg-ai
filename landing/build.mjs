import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const landingDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.dirname(landingDirectory);
const outputDirectory = path.join(landingDirectory, 'dist');
const trackerBuildDirectory = path.join(repositoryDirectory, 'dist', 'ui');

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

for (const fileName of ['index.html', 'styles.css', 'script.js', 'og.png']) {
  fs.copyFileSync(path.join(landingDirectory, fileName), path.join(outputDirectory, fileName));
}
fs.cpSync(path.join(landingDirectory, 'assets'), path.join(outputDirectory, 'assets'), { recursive: true });

fs.copyFileSync(path.join(trackerBuildDirectory, 'tracker.html'), path.join(outputDirectory, 'shared-replay.html'));
fs.cpSync(path.join(trackerBuildDirectory, 'assets'), path.join(outputDirectory, 'assets'), { recursive: true });
fs.cpSync(path.join(trackerBuildDirectory, 'tracker-assets'), path.join(outputDirectory, 'tracker-assets'), { recursive: true });

console.log(`Built Trace landing page and shared replay viewer in ${outputDirectory}`);
