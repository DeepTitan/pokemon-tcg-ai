#!/usr/bin/env npx ts-node
/**
 * Helper script to add the "import-cards" script entry to package.json
 * Run this once to set up the npm script.
 */

import * as fs from 'fs';
import * as path from 'path';

const packageJsonPath = path.join(process.cwd(), 'package.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

// Add the import-cards script
packageJson.scripts['import-cards'] = 'ts-node scripts/import-cards.ts';

fs.writeFileSync(
  packageJsonPath,
  JSON.stringify(packageJson, null, 2) + '\n'
);

console.log('✅ Added "import-cards" script to package.json');
console.log('   Run with: npm run import-cards');
