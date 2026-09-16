import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const output = new URL('./worker-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [new URL('./worker.ts', import.meta.url).pathname],
  outfile: new URL('./worker.mjs', output).pathname,
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['@aws-sdk/*'],
});
await cp(new URL('./assets/', import.meta.url), new URL('./assets/', output), { recursive: true });
// This is Trace's complete public printed-card catalog, not the small set of
// cards previously encountered in the leaderboard's historical migration.
await cp(new URL('../../landing/assets/share-card-catalog.json.gz', import.meta.url),
  new URL('./assets/printed-catalog.json.gz', output));
