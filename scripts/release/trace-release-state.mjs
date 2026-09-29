#!/usr/bin/env node
// Read-only guard for uploads. Never creates, edits or publishes a release.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateReleaseState(release, { tag, sourceSha, manual = false, requireExisting = false }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new Error('Invalid release tag or source commit.');
  }
  if (release === null) {
    if (requireExisting) throw new Error('The expected release is missing.');
    return { releaseDraft: true };
  }
  if (!release || release.tagName !== tag || typeof release.isDraft !== 'boolean') {
    throw new Error('GitHub returned an unexpected release.');
  }
  if (manual && !release.isDraft) throw new Error('Manual runs cannot overwrite a published release.');
  // Drafts have no immutable tag in some GitHub states. Bind their upload
  // target to the exact source SHA rather than trusting a mutable branch name.
  if (release.isDraft && release.targetCommitish !== sourceSha) {
    throw new Error('The existing draft belongs to a different or ambiguous source commit.');
  }
  return { releaseDraft: release.isDraft };
}

export function readRelease(tag, repository, run = execFileSync) {
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository.');
    // Listing with the repository token includes drafts. A successful complete
    // listing establishes absence; gh release view can collapse one failed
    // draft/public lookup into its generic "release not found" result.
    const pages = JSON.parse(run('gh', ['api', '--paginate', '--slurp',
      `repos/${repository}/releases?per_page=100`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }));
    if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page))) throw new Error('Invalid release listing.');
    const matches = pages.flat().filter(release => release.tag_name === tag);
    if (matches.length > 1) throw new Error('Ambiguous release target.');
    const release = matches[0];
    return release ? { tagName: release.tag_name, isDraft: release.draft, targetCommitish: release.target_commitish } : null;
  } catch {
    throw new Error('Could not verify GitHub release state; stop before modifying assets.');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { RELEASE_TAG: tag, RELEASE_SHA: sourceSha, GITHUB_REPOSITORY: repository } = process.env;
  const manual = process.env.RELEASE_MANUAL === 'true';
  const options = { tag, sourceSha, manual, requireExisting: process.argv.includes('--require-existing') };
  // Validate the selectors before invoking gh; no user-supplied shell code.
  validateReleaseState(null, { ...options, requireExisting: false });
  const state = validateReleaseState(readRelease(tag, repository), options);
  if (process.argv.includes('--github-output') && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `releaseDraft=${state.releaseDraft}\n`);
  }
  process.stdout.write(`${JSON.stringify(state)}\n`);
}
