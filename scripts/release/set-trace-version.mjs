#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: node set-trace-version.mjs <major.minor.patch>');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = resolve(repoRoot, 'src-tauri/tauri.conf.json');
const cargoPath = resolve(repoRoot, 'src-tauri/Cargo.toml');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.version = version;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const cargo = readFileSync(cargoPath, 'utf8').replace(
  /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  `$1${version}$2`,
);
writeFileSync(cargoPath, cargo);
console.log(`Trace release version set to ${version}`);
