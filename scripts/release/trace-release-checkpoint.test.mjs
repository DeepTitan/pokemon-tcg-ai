import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bumpVersion, planRelease, readMarker, stripMarkers } from './trace-release-checkpoint.mjs';
import { readRelease, validateReleaseState } from './trace-release-state.mjs';

assert.equal(readMarker('ship it [PATCH]'), 'PATCH');
assert.equal(readMarker('[minor] add cloud backup'), 'MINOR');
assert.equal(readMarker('[PATCH] also [MAJOR]'), 'MAJOR');
assert.equal(readMarker('ordinary commit'), null);
assert.equal(bumpVersion('0.1.17', 'PATCH'), '0.1.18');
assert.equal(bumpVersion('0.1.17', 'MINOR'), '0.2.0');
assert.equal(bumpVersion('0.1.17', 'MAJOR'), '1.0.0');
assert.equal(stripMarkers('[PATCH] ship updater'), 'ship updater');

const sourceSha = 'a'.repeat(40);
const context = { commitSha: sourceSha, subject: 'Trace membership release', body: 'Trace membership release', latestVersion: '0.1.88' };
assert.equal(planRelease(context).shouldRelease, false);
assert.equal(planRelease(context).shouldPublish, false);
const automatic = planRelease({ ...context, body: '[PATCH] Trace membership release' });
assert.equal(automatic.tag, 'v0.1.89');
assert.equal(automatic.shouldPublish, true, 'ordinary main marker behavior remains automatic');
const candidate = planRelease({ ...context, body: '[MAJOR] unrelated marker', manualLevel: 'PATCH' });
assert.equal(candidate.tag, 'v0.1.89', 'manual level controls the candidate, even on a marker commit');
assert.equal(candidate.shouldRelease, true);
assert.equal(candidate.shouldPublish, false, 'manual runs hold by default');
assert.equal(candidate.manualRelease, true);
assert.equal(planRelease({ ...context, manualLevel: 'PATCH', publish: 'false' }).shouldPublish, false);
assert.equal(planRelease({ ...context, manualLevel: 'PATCH', publish: 'true' }).shouldPublish, false, 'truthy strings cannot authorize publishing');
assert.equal(planRelease({ ...context, manualLevel: 'PATCH', publish: true }).shouldPublish, true);
assert.equal(planRelease({ ...context, manualLevel: 'PATCH', headVersion: '0.1.89', latestVersion: '0.1.89' }).tag, 'v0.1.89', 'rerunning the same tagged candidate retains its version');
assert.throws(() => planRelease({ ...context, manualLevel: 'patch' }), /Invalid manual release level/);
assert.throws(() => planRelease({ ...context, expectedSha: 'b'.repeat(40) }), /source does not match/);
assert.throws(() => planRelease({ ...context, expectedSha: '' }), /source does not match/);
assert.equal(planRelease({ ...context, expectedSha: sourceSha }).commitSha, sourceSha);

const target = { tag: 'v0.1.89', sourceSha, manual: true };
const draft = { tagName: target.tag, targetCommitish: sourceSha, isDraft: true };
assert.deepEqual(validateReleaseState(null, target), { releaseDraft: true });
assert.deepEqual(validateReleaseState(draft, target), { releaseDraft: true });
assert.throws(() => validateReleaseState(null, { ...target, requireExisting: true }), /expected release is missing/);
assert.throws(() => validateReleaseState({ ...draft, isDraft: false }, target), /cannot overwrite a published release/);
assert.throws(() => validateReleaseState({ ...draft, targetCommitish: 'main' }, target), /different or ambiguous/);
assert.throws(() => validateReleaseState({ ...draft, targetCommitish: 'main' }, { ...target, manual: false }), /different or ambiguous/, 'ambiguous legacy drafts require source resolution before any overwrite');
assert.throws(() => validateReleaseState({ ...draft, targetCommitish: 'b'.repeat(40) }, target), /different or ambiguous/);
assert.throws(() => validateReleaseState({ ...draft, tagName: 'v0.1.90' }, target), /unexpected release/);
assert.throws(() => validateReleaseState({ ...draft, isDraft: 'true' }, target), /unexpected release/);
assert.deepEqual(validateReleaseState({ ...draft, isDraft: false }, { ...target, manual: false }), { releaseDraft: false }, 'automatic same-tag reruns retain prior behavior after workflow tag verification');
assert.equal(readRelease(target.tag, 'fixture/repository', () => '[[]]'), null);
for (const failure of [Object.assign(new Error('missing'), { status: 1, stderr: 'release not found' }),
  Object.assign(new Error('network'), { status: 1, stderr: 'HTTP 503' }),
  Object.assign(new Error('auth'), { status: 1, stderr: 'HTTP 401' }),
  Object.assign(new Error('unknown'), { status: 2, stderr: 'release not found' })]) {
  assert.throws(() => readRelease(target.tag, 'fixture/repository', () => { throw failure; }), /Could not verify/);
}
assert.throws(() => readRelease(target.tag, 'fixture/repository', () => '{broken'), /Could not verify/);
const rawDraft = { tag_name: target.tag, target_commitish: sourceSha, draft: true };
assert.deepEqual(readRelease(target.tag, 'fixture/repository', (command, args) => {
  assert.equal(command, 'gh');
  assert.deepEqual(args, ['api', '--paginate', '--slurp', 'repos/fixture/repository/releases?per_page=100']);
  return JSON.stringify([[{ ...rawDraft, tag_name: 'v0.1.88' }], [rawDraft]]);
}), draft);
assert.throws(() => readRelease(target.tag, 'fixture/repository', () => JSON.stringify([[rawDraft], [rawDraft]])), /Could not verify/);
assert.throws(() => readRelease(target.tag, 'fixture/repository', () => '[]'), /Could not verify/);

const releaseWorkflow = fs.readFileSync('.github/workflows/trace-release-checkpoint.yml', 'utf8');
const signingSmokeWorkflow = fs.readFileSync('.github/workflows/trace-windows-signing-smoke.yml', 'utf8');
const installerHooks = fs.readFileSync('src-tauri/windows/installer-hooks.nsh', 'utf8');
assert.match(releaseWorkflow, /Configure Microsoft Artifact Signing/);
assert.match(releaseWorkflow, /workflow_dispatch:[\s\S]*publish:[\s\S]*type: boolean\s+default: false/);
assert.match(releaseWorkflow, /source_sha:[\s\S]*type: string\s+required: true/);
assert.match(releaseWorkflow, /--release-level "\$RELEASE_LEVEL" --expected-sha "\$RELEASE_EXPECTED_SHA"/);
assert.match(releaseWorkflow, /group:.*github\.event_name == 'workflow_dispatch'.*'trace-release'/);
assert.match(releaseWorkflow, /ref: \$\{\{ github\.sha \}\}/);
assert.equal((releaseWorkflow.match(/ref: \$\{\{ needs\.checkpoint\.outputs\.commitSha \}\}/g) || []).length, 2, 'build and updater jobs use the checkpoint source');
assert.match(releaseWorkflow, /releaseCommitish: \$\{\{ needs\.checkpoint\.outputs\.commitSha \}\}/);
assert.match(releaseWorkflow, /releaseDraft: \$\{\{ needs\.checkpoint\.outputs\.shouldPublish != 'true' \|\| steps\.upload-state\.outputs\.releaseDraft == 'true' \}\}/);
for (const step of ['Publish verified release', 'Verify network update manifest']) {
  assert.match(releaseWorkflow, new RegExp(`- name: ${step}\\n        if: needs\\.checkpoint\\.outputs\\.shouldPublish == 'true'`));
}
assert.match(releaseWorkflow, /- name: Confirm held candidate\s+if: needs\.checkpoint\.outputs\.shouldPublish != 'true'/);
assert.match(releaseWorkflow, /if \[\[ "\$VERIFY_APP_LAUNCH" == 'true' \]\]; then[\s\S]*"\$executable_path"[\s\S]*verify-macos-helper-bundle\.sh "\$fresh_app"\s+fi/);
assert.doesNotMatch(releaseWorkflow, /gh release view[\s\S]{0,180}2>\/dev\/null/);
assert.match(releaseWorkflow, /Authenticate to Azure with GitHub OIDC/);
assert.match(releaseWorkflow, /uses: azure\/login@v3/);
assert.match(releaseWorkflow, /id-token: write/);
assert.doesNotMatch(releaseWorkflow, /AZURE_CLIENT_SECRET/);
assert.match(releaseWorkflow, /Microsoft\.ArtifactSigning\.Client/);
assert.match(releaseWorkflow, /sign-windows-artifact\.ps1/);
assert.match(releaseWorkflow, /cmd = 'pwsh'/);
assert.match(releaseWorkflow, /args = @\(/);
assert.match(releaseWorkflow, /AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE/);
assert.match(releaseWorkflow, /Verify trusted Windows publisher signatures/);
assert.match(releaseWorkflow, /Get-AuthenticodeSignature/);
assert.match(releaseWorkflow, /7z x/);
assert.match(releaseWorkflow, /Packaged application Authenticode signature: valid/);
assert.match(releaseWorkflow, /SIGNTOOL_PATH verify \/pa \/all \/v/);
assert.match(signingSmokeWorkflow, /workflow_dispatch/);
assert.match(signingSmokeWorkflow, /Authenticate to Azure with GitHub OIDC/);
assert.match(signingSmokeWorkflow, /sign-windows-artifact\.ps1/);
assert.match(signingSmokeWorkflow, /Get-AuthenticodeSignature/);
assert.match(installerHooks, /\$PassiveMode != 1/);
assert.match(installerHooks, /Get-Process -Name \$\\"Pokemon TCG Live\$\\"/);
assert.match(installerHooks, /TRACE_BLOCK_UNSAFE_MANUAL_INSTALL[\s\S]*Abort/);
assert.match(installerHooks, /NSIS_HOOK_PREINSTALL[\s\S]*TRACE_BLOCK_UNSAFE_MANUAL_INSTALL[\s\S]*TRACE_CLEAN_CAPTURE_ROUTE/);
console.log('Trace release checkpoint tests passed.');
