// Offline review helper. This script never calls Vercel, stages, publishes or deploys.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const directory = new URL('../docs/apex-routing/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const baseline = read(new URL('live-baseline.json', directory));
export const additions = ['add-membership-api.json', 'add-member-script.json'].map((name) => read(new URL(name, directory)));
const originalIds = new Set(baseline.routes.map(({ id }) => id));
const stable = ({ id, name, description, enabled, route, srcSyntax, routeType }) => ({ id, name, description, enabled, route, srcSyntax, routeType });
export function verifyCurrent(snapshot, versions) {
  assert.equal(snapshot.version?.id, baseline.version.id, 'Live route version changed; re-review before staging.');
  assert.deepEqual(snapshot.routes.map(stable), baseline.routes.map(stable), 'Existing routes or their order changed.');
  assert(snapshot.routes.every((route) => route.staged !== true), 'Existing staged changes need separate review.');
  assert.equal(versions.versions.find((version) => version.isLive)?.id, baseline.version.id, 'Unexpected live version.');
  assert(!versions.versions.some((version) => version.isStaging), 'Do not combine with somebody else’s staged changes.');
  return true;
}
export function verifyStaged(snapshot) {
  assert.equal(snapshot.routes?.length, baseline.routes.length + additions.length, 'Expected exactly two new routes.');
  assert.equal(new Set(snapshot.routes.map(({ id }) => id)).size, snapshot.routes.length, 'Route IDs must remain unique.');
  const old = snapshot.routes.filter(({ id }) => originalIds.has(id));
  assert.deepEqual(old.map(stable), baseline.routes.map(stable), 'Existing routes must be unchanged and retain their order.');
  const fresh = snapshot.routes.filter(({ id }) => !originalIds.has(id));
  for (const input of additions) {
    const actual = fresh.find(({ route }) => route.src === input.route.route.src);
    assert(actual, `Missing route: ${input.route.route.src}`);
    assert.deepEqual(actual.route, input.route.route, 'No extra query/header/cache transformations permitted.');
    assert.equal(actual.enabled, true);
    assert.equal(actual.srcSyntax, input.route.srcSyntax);
    assert.equal(actual.routeType, 'rewrite');
    assert(snapshot.routes.indexOf(actual) < snapshot.routes.findIndex(({ id }) => id === input.position.referenceId), 'New routes must precede the public share catch-all.');
  }
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, snapshot, versions] = process.argv.slice(2);
  try {
    if (mode === '--current' && snapshot && versions) verifyCurrent(read(snapshot), read(versions));
    else if (mode === '--staged' && snapshot) verifyStaged(read(snapshot));
    else throw new Error(`Usage: node ${fileURLToPath(import.meta.url)} --current routes.json versions.json | --staged routes.json`);
    console.log('Route review passed. No Vercel changes were made.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
