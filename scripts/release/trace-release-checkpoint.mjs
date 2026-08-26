#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = ['MAJOR', 'MINOR', 'PATCH'];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const args = new Set(process.argv.slice(2));

export function readMarker(message) {
  const matches = [...message.matchAll(/\[(major|minor|patch)\]/gi)]
    .map((match) => match[1].toUpperCase());
  return MARKERS.find((marker) => matches.includes(marker)) ?? null;
}

export function bumpVersion(version, marker) {
  const parsed = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  const major = Number(parsed?.[1] ?? 0);
  const minor = Number(parsed?.[2] ?? 0);
  const patch = Number(parsed?.[3] ?? 0);
  if (marker === 'MAJOR') return `${major + 1}.0.0`;
  if (marker === 'MINOR') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function stripMarkers(value) {
  return value.replace(/\s*\[(?:major|minor|patch)\]\s*/gi, ' ').trim();
}

function git(gitArgs, optional = false) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', optional ? 'ignore' : 'inherit'],
    }).trim();
  } catch (error) {
    if (optional) return '';
    throw error;
  }
}

function readLatestVersion() {
  const latestTag = git(['tag', '--list', 'v[0-9]*', '--sort=-v:refname'], true)
    .split('\n')
    .map((tag) => tag.trim())
    .find((tag) => /^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(tag));
  if (latestTag) return latestTag.slice(1);

  const config = JSON.parse(readFileSync(resolve(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  return /^\d+\.\d+\.\d+/.test(config.version) ? config.version : '0.0.0';
}

function readHeadVersion() {
  const tag = git(['tag', '--points-at', 'HEAD', '--list', 'v[0-9]*'], true)
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => /^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(candidate));
  return tag?.slice(1) ?? null;
}

function writeGitHubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value ?? '')}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

export function checkpoint() {
  const commitSha = git(['rev-parse', 'HEAD']);
  const subject = git(['log', '-1', '--pretty=%s']);
  const body = git(['log', '-1', '--pretty=%B']);
  const releaseLevel = readMarker(body);
  const headVersion = readHeadVersion();
  const baseVersion = headVersion ?? readLatestVersion();
  const version = releaseLevel ? headVersion ?? bumpVersion(baseVersion, releaseLevel) : baseVersion;
  const tag = `v${version}`;
  const releaseNote = stripMarkers(subject) || `Trace ${version}`;

  return {
    shouldRelease: Boolean(releaseLevel),
    releaseLevel: releaseLevel ?? '',
    version,
    baseVersion,
    tag,
    commitSha,
    shortSha: commitSha.slice(0, 12),
    releaseNote,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = checkpoint();
  if (args.has('--github-output')) writeGitHubOutput(result);
  if (args.has('--json') || !args.has('--github-output')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
