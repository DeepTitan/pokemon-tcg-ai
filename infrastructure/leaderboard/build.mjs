import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Every supported publisher build must pass the history and publication
// contracts. Run before replacing the previous bundle; a failing check aborts.
const root = fileURLToPath(new URL('../../', import.meta.url));
for (const test of [
  'scripts/__tests__/leaderboard-history-preview.test.ts',
  'infrastructure/leaderboard/catalog.test.ts',
  'infrastructure/leaderboard/worker.test.ts',
  'infrastructure/leaderboard/publisher-lease.test.ts',
  'scripts/__tests__/leaderboard-public-snapshot.test.ts',
  'scripts/__tests__/leaderboard-client-exit-rating.test.ts',
]) {
  execFileSync(process.execPath, ['--import', 'tsx', test], { cwd: root, stdio: 'inherit' });
}

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
