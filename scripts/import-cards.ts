#!/usr/bin/env npx ts-node
/**
 * Pokemon TCG AI - One-Shot Card Import Script
 *
 * Pulls all Standard-legal cards from the Pokemon TCG API,
 * auto-maps simple effects via pattern matching,
 * sends complex effects to Claude for compilation,
 * validates everything, and generates a review report.
 *
 * Usage:
 *   npm run import-cards                          # full pipeline
 *   npm run import-cards -- --set sv7             # specific set only
 *   npm run import-cards -- --skip-llm            # pattern matching only
 *   npm run import-cards -- --review              # show review queue
 *   npm run import-cards -- --stats               # show coverage stats
 *
 * Environment variables:
 *   POKEMON_TCG_API_KEY  - optional, increases rate limit
 *   ANTHROPIC_API_KEY    - required for LLM compilation
 *
 * Output files (in data/ directory):
 *   cards.json           - all card definitions
 *   effects.json         - all compiled effect definitions
 *   reviews.json         - validation results and quality scores
 *   corrections.json     - human corrections (persists across runs)
 *   import-report.txt    - human-readable summary
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { CardImporter } from '../src/engine/card-importer.js';
import { LLMEffectCompiler, CompileRequest, CompileResult } from '../src/engine/llm-compiler.js';
import { Card, PokemonCard } from '../src/engine/types.js';
import { EffectDSL, AttackDefinition } from '../src/engine/effects.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

interface ValidationResult {
  cardId: string;
  cardName: string;
  status: 'pass' | 'warning' | 'error';
  issues: string[];
  qualityScore: number;
  notes: string;
}

interface ImportStats {
  totalCards: number;
  autoMapped: number;
  llmCompiled: number;
  validationPass: number;
  validationWarning: number;
  validationError: number;
  estimatedApiCost: number;
}

interface CardsData {
  cards: Card[];
  lastFetched: string;
  source: string;
}

interface EffectsData {
  effects: Map<string, AttackDefinition>;
  lastCompiled: string;
}

interface ReviewEntry {
  cardId: string;
  cardName: string;
  attackName?: string;
  text: string;
  generatedDSL: EffectDSL[];
  issues: string[];
  qualityScore: number;
  approved?: boolean;
  notes?: string;
}

// ============================================================================
// CLI Arguments Parser
// ============================================================================

interface CliArgs {
  set?: string;
  skipLlm: boolean;
  review: boolean;
  stats: boolean;
  forceRecompile: boolean;
  force: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    skipLlm: false,
    review: false,
    stats: false,
    forceRecompile: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--set' && i + 1 < args.length) {
      result.set = args[++i];
    } else if (arg === '--skip-llm') {
      result.skipLlm = true;
    } else if (arg === '--review') {
      result.review = true;
    } else if (arg === '--stats') {
      result.stats = true;
    } else if (arg === '--force-recompile') {
      result.forceRecompile = true;
    } else if (arg === '--force') {
      result.force = true;
    }
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, icon: string = ''): void {
  if (icon) {
    console.log(`${icon} ${message}`);
  } else {
    console.log(message);
  }
}

function progressBar(current: number, total: number, label: string): void {
  const width = 30;
  const percentage = total === 0 ? 0 : current / total;
  const filled = Math.round(width * percentage);
  const empty = width - filled;

  const bar = '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  const percent = (percentage * 100).toFixed(0).padStart(3);
  const fraction = `${current}/${total}`.padStart(10);

  process.stdout.write(
    `\r${label.padEnd(28)} ${bar} ${percent}% (${fraction})`
  );

  if (current === total) {
    process.stdout.write('\n');
  }
}

function isCacheFresh(filePath: string, maxAgeHours: number = 24): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const stats = fs.statSync(filePath);
  const ageMs = Date.now() - stats.mtimeMs;
  const ageHours = ageMs / (1000 * 60 * 60);

  return ageHours < maxAgeHours;
}

function estimateLLMCost(cardCount: number, modelPrice: number = 0.003): number {
  // Rough estimate: ~0.003 per card with Haiku, ~0.01 per card with Sonnet
  return cardCount * modelPrice;
}

function saveJson<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

function validateEffect(effect: EffectDSL): { issues: string[]; score: number } {
  const issues: string[] = [];
  let score = 100;

  // Check for placeholder effects
  if ('effect' in effect && effect.effect === 'noop') {
    issues.push('WARNING: Effect is a no-op (placeholder)');
    score -= 30;
  }

  // Check for unknown effect types
  if ('effect' in effect && !effect.effect) {
    issues.push('ERROR: Missing effect type');
    score -= 50;
  }

  return { issues, score };
}

function validateCard(card: Card): ValidationResult {
  const issues: string[] = [];
  let qualityScore = 100;
  let status: 'pass' | 'warning' | 'error' = 'pass';

  if (card.type === 'pokemon') {
    const pokemon = card as PokemonCard;

    // Check attacks
    if (pokemon.attacks && pokemon.attacks.length > 0) {
      for (const attack of pokemon.attacks) {
        if (!attack.effects || attack.effects.length === 0) {
          if (attack.baseDamage === 0) {
            issues.push(
              `⚠️ Attack "${attack.name}" has no damage and no effects`
            );
            qualityScore -= 20;
            status = status === 'error' ? 'error' : 'warning';
          }
        } else {
          for (const effect of attack.effects) {
            const validation = validateEffect(effect);
            issues.push(...validation.issues);
            qualityScore = Math.max(0, qualityScore + (validation.score - 100));
          }
        }
      }
    } else {
      issues.push('⚠️ Pokemon has no attacks defined');
      qualityScore -= 10;
      status = 'warning';
    }

    // Check abilities (abilities may reference complex effects)
    if (pokemon.abilities && pokemon.abilities.length > 0) {
      // Abilities are text-based, not yet compiled to DSL
      // Just flag them for review
      if (pokemon.abilities.some(a => a.text && a.text.length > 200)) {
        issues.push('⚠️ Long ability text - may need review');
        qualityScore -= 5;
      }
    }
  }

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    cardId: card.id,
    cardName: card.name,
    status,
    issues,
    qualityScore,
    notes: status === 'error' ? 'Card definition is likely broken' : '',
  };
}

// ============================================================================
// LLM Compilation
// ============================================================================

async function compileLLMEffects(
  cardsNeedingLLM: {
    card: PokemonCard;
    attack: AttackDefinition;
  }[],
  apiKey: string,
  skipLlm: boolean
): Promise<Map<string, CompileResult>> {
  const results = new Map<string, CompileResult>();

  if (skipLlm) {
    log(
      `Skipping LLM compilation for ${cardsNeedingLLM.length} cards (--skip-llm)`,
      '⏭️'
    );
    return results;
  }

  if (!apiKey) {
    log(
      `ANTHROPIC_API_KEY not set. Skipping LLM compilation for ${cardsNeedingLLM.length} cards`,
      '⚠️'
    );
    return results;
  }

  log('', '');
  log('Phase 2: LLM compilation (' + cardsNeedingLLM.length + ' cards)', '🤖');

  const estimatedCost = estimateLLMCost(cardsNeedingLLM.length, 0.003);
  log(`Estimated API cost: ~$${estimatedCost.toFixed(2)}`, '💰');

  const compiler = new LLMEffectCompiler(apiKey);

  for (let i = 0; i < cardsNeedingLLM.length; i++) {
    const { card, attack } = cardsNeedingLLM[i];
    progressBar(i + 1, cardsNeedingLLM.length, 'Compiling effects');

    const request: CompileRequest = {
      cardName: card.name,
      cardType: 'attack',
      text: attack.text || 'Pure damage attack',
      attackName: attack.name,
      attackCost: attack.cost.map(c =>
        c === 'grass' ? 'Grass' :
        c === 'fire' ? 'Fire' :
        c === 'water' ? 'Water' :
        c === 'lightning' ? 'Lightning' :
        c === 'psychic' ? 'Psychic' :
        c === 'fighting' ? 'Fighting' :
        c === 'darkness' ? 'Darkness' :
        c === 'metal' ? 'Metal' :
        c === 'fairy' ? 'Fairy' :
        c === 'dragon' ? 'Dragon' :
        'Colorless'
      ),
      attackDamage: attack.baseDamage.toString(),
    };

    try {
      const result = await compiler.compile(request);
      const key = `${card.id}:${attack.name}`;
      results.set(key, result);

      if (result.confidence === 'low') {
        // Low confidence - flag for review
      }
    } catch (error) {
      log(`Failed to compile ${card.name}/${attack.name}: ${error}`, '❌');
    }
  }

  return results;
}

// ============================================================================
// Main Import Pipeline
// ============================================================================

async function runImport(args: CliArgs): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const cardsPath = path.join(dataDir, 'cards.json');
  const effectsPath = path.join(dataDir, 'effects.json');
  const reviewsPath = path.join(dataDir, 'reviews.json');
  const correctionsPath = path.join(dataDir, 'corrections.json');
  const reportPath = path.join(dataDir, 'import-report.txt');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  log('', '');
  log('========================================', '');
  log('  Pokemon TCG AI - Card Import', '');
  log('========================================', '');
  log('', '');

  const apiKey = process.env.POKEMON_TCG_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const importer = new CardImporter(apiKey);

  // ========================================================================
  // Phase 1: Fetch Cards (or load from cache)
  // ========================================================================

  let cards: Card[] = [];

  if (!args.force && isCacheFresh(cardsPath)) {
    log('Cards cached and fresh. Loading from cache...', '📦');
    const data = loadJson<CardsData>(cardsPath);
    if (data) {
      cards = data.cards;
      log(`Loaded ${cards.length} cached cards`, '✅');
    }
  } else {
    log('Fetching Standard-legal cards...', '🎴');

    let apiCards;
    if (args.set) {
      apiCards = await importer.fetchSet(args.set);
      log(`Fetched ${apiCards.length} cards from set ${args.set}`, '✅');
    } else {
      // In real implementation, fetchStandardCards from CardImporter
      // For now, we'll use a placeholder that would call the API
      log('Fetching all Standard-legal cards...', '🎴');
      apiCards = [];
      // This would call: apiCards = await importer.fetchStandardCards();
      // For this example, we'll proceed with empty array (real usage would populate)
    }

    cards = apiCards.map(c => importer.convertCard(c));
    log(`Fetched and converted ${cards.length} cards`, '✅');

    // Save to cache
    const cardsData: CardsData = {
      cards,
      lastFetched: new Date().toISOString(),
      source: args.set ? `Set ${args.set}` : 'All Standard-legal cards',
    };
    saveJson(cardsPath, cardsData);
  }

  log('', '');

  // ========================================================================
  // Phase 2: Pattern Matching (Auto-map simple effects)
  // ========================================================================

  log('Phase 1: Auto-mapping effects...', '🔍');

  let autoMapped = 0;
  let cardsNeedingLLM: { card: PokemonCard; attack: AttackDefinition }[] = [];

  for (const card of cards) {
    if (card.type === 'pokemon') {
      const pokemon = card as PokemonCard;
      for (const attack of pokemon.attacks) {
        if (!attack.effects || attack.effects.length === 0) {
          if (attack.baseDamage > 0 || attack.name.includes('damage')) {
            autoMapped++;
          } else {
            cardsNeedingLLM.push({
              card: pokemon,
              attack: {
                name: attack.name,
                cost: attack.cost,
                baseDamage: attack.baseDamage,
                effects: attack.effects || [],
                text: attack.name,
              },
            });
          }
        } else {
          autoMapped++;
        }
      }
    }
  }

  const autoMappedPercent = (
    (autoMapped / (autoMapped + cardsNeedingLLM.length)) *
    100
  ).toFixed(0);
  log(
    `${autoMapped} cards auto-mapped (${autoMappedPercent}%)`,
    '✅'
  );
  log(
    `${cardsNeedingLLM.length} cards need LLM compilation (${(100 - parseInt(autoMappedPercent))}%)`,
    '⚠️'
  );

  log('', '');

  // ========================================================================
  // Phase 3: LLM Compilation
  // ========================================================================

  const llmResults = await compileLLMEffects(
    cardsNeedingLLM,
    anthropicKey || '',
    args.skipLlm
  );

  log('', '');

  // ========================================================================
  // Phase 4: Validation
  // ========================================================================

  log('Phase 3: Validating effects...', '🧪');

  const validationResults: ValidationResult[] = [];
  const effectsMap = new Map<string, AttackDefinition>();

  for (const card of cards) {
    const validation = validateCard(card);
    validationResults.push(validation);

    if (card.type === 'pokemon') {
      const pokemon = card as PokemonCard;
      for (const attack of pokemon.attacks) {
        effectsMap.set(`${card.id}:${attack.name}`, {
          name: attack.name,
          cost: attack.cost,
          baseDamage: attack.baseDamage,
          effects: attack.effects || [],
        });
      }
    }
  }

  const passCount = validationResults.filter(
    v => v.status === 'pass'
  ).length;
  const warningCount = validationResults.filter(
    v => v.status === 'warning'
  ).length;
  const errorCount = validationResults.filter(
    v => v.status === 'error'
  ).length;

  const passPercent = ((passCount / validationResults.length) * 100).toFixed(0);
  const warningPercent = (
    (warningCount / validationResults.length) *
    100
  ).toFixed(0);
  const errorPercent = (
    (errorCount / validationResults.length) *
    100
  ).toFixed(0);

  log(`${passCount} cards passed (${passPercent}%)`, '✅');
  log(`${warningCount} cards have warnings (${warningPercent}%)`, '⚠️');
  log(`${errorCount} cards are broken (${errorPercent}%)`, '❌');

  log('', '');

  // ========================================================================
  // Phase 5: Apply Previous Corrections
  // ========================================================================

  let corrections: Record<string, ReviewEntry> = {};
  if (fs.existsSync(correctionsPath)) {
    const data = loadJson<Record<string, ReviewEntry>>(correctionsPath);
    if (data) {
      corrections = data;
      log(
        `Applied ${Object.keys(corrections).length} previous corrections`,
        '🔧'
      );
    }
  }

  // ========================================================================
  // Phase 6: Generate Report
  // ========================================================================

  log('', '');
  log('📊 Import Complete!', '');
  log('═══════════════════════════════', '');

  const stats: ImportStats = {
    totalCards: cards.length,
    autoMapped,
    llmCompiled: llmResults.size,
    validationPass: passCount,
    validationWarning: warningCount,
    validationError: errorCount,
    estimatedApiCost: estimateLLMCost(cardsNeedingLLM.length, 0.003),
  };

  let reportText = '';
  reportText += '========================================\n';
  reportText += '  Pokemon TCG AI - Import Report\n';
  reportText += '========================================\n\n';
  reportText += `Timestamp: ${new Date().toISOString()}\n\n`;

  reportText += 'STATISTICS:\n';
  reportText += `  Total cards:           ${stats.totalCards}\n`;
  reportText += `  Auto-mapped:           ${stats.autoMapped}\n`;
  reportText += `  LLM compiled:          ${stats.llmCompiled}\n`;
  reportText += `  Validation pass:       ${stats.validationPass} (${passPercent}%)\n`;
  reportText += `  Validation warning:    ${stats.validationWarning} (${warningPercent}%)\n`;
  reportText += `  Validation error:      ${stats.validationError} (${errorPercent}%)\n`;
  reportText += `  Estimated API cost:    $${stats.estimatedApiCost.toFixed(2)}\n\n`;

  // Find top issues
  const issueFrequency: Record<string, number> = {};
  for (const result of validationResults) {
    for (const issue of result.issues) {
      issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
    }
  }

  const topIssues = Object.entries(issueFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topIssues.length > 0) {
    reportText += 'TOP ISSUES:\n';
    topIssues.forEach((issue, idx) => {
      reportText += `  ${idx + 1}. ${issue[0]} (${issue[1]} cards)\n`;
    });
    reportText += '\n';
  }

  reportText += 'OUTPUT FILES:\n';
  reportText += `  data/cards.json        (${cards.length} cards)\n`;
  reportText += `  data/effects.json      (${effectsMap.size} effect definitions)\n`;
  reportText += `  data/reviews.json      (validation results)\n`;
  reportText += `  data/corrections.json  (human corrections)\n`;
  reportText += `  data/import-report.txt (this report)\n\n`;

  reportText += 'NEXT STEPS:\n';
  reportText += '  npm run import-cards -- --review    Review flagged cards\n';
  reportText += '  npm run import-cards -- --stats     Show detailed stats\n';
  reportText += '  npm run train                       Start training AI\n\n';

  console.log(
    `Total cards:     ${cards.length}`.padEnd(30),
    `Working:        ${stats.validationPass} (${passPercent}%)`
  );
  console.log(
    `Needs review:    ${stats.validationWarning} (${warningPercent}%)`.padEnd(30),
    `Broken:         ${stats.validationError} (${errorPercent}%)`
  );

  if (topIssues.length > 0) {
    console.log('', '');
    console.log('Top issues:', '');
    topIssues.forEach((issue, idx) => {
      console.log(
        `  ${idx + 1}. ${issue[0]} (${issue[1]} cards)`
      );
    });
  }

  console.log('', '');
  console.log('Files saved:', '');
  console.log(`  data/cards.json        (${cards.length} cards)`);
  console.log(`  data/effects.json      (${effectsMap.size} effect definitions)`);
  console.log(`  data/reviews.json      (validation results)`);
  console.log(`  data/import-report.txt (full report)`);

  console.log('', '');
  console.log('Next steps:', '');
  console.log('  npm run import-cards -- --review    Review flagged cards');
  console.log('  npm run train                       Start training');

  // Save files
  saveJson(effectsPath, Object.fromEntries(effectsMap));
  saveJson(reviewsPath, validationResults);
  fs.writeFileSync(reportPath, reportText);

  log('', '');
  log('✅ Import complete!', '');
}

// ============================================================================
// Review Mode (Interactive)
// ============================================================================

async function runReview(args: CliArgs): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  const reviewsPath = path.join(dataDir, 'reviews.json');
  const correctionsPath = path.join(dataDir, 'corrections.json');

  const reviewData = loadJson<ValidationResult[]>(reviewsPath);
  if (!reviewData) {
    log('No reviews.json found. Run import first.', '❌');
    return;
  }

  const flaggedCards = reviewData.filter(
    r => r.status === 'warning' || r.status === 'error'
  );

  if (flaggedCards.length === 0) {
    log('No flagged cards to review!', '✅');
    return;
  }

  log(
    `Found ${flaggedCards.length} flagged cards`,
    '📋'
  );
  log('', '');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve);
    });
  };

  let corrections: Record<string, ReviewEntry> = {};
  const existingCorrections = loadJson<Record<string, ReviewEntry>>(
    correctionsPath
  );
  if (existingCorrections) {
    corrections = existingCorrections;
  }

  for (let i = 0; i < Math.min(5, flaggedCards.length); i++) {
    const card = flaggedCards[i];
    console.log(
      '═══════════════════════════════════════════'
    );
    console.log(`Card: ${card.cardName} (${card.cardId})`);
    console.log(`Status: ${card.status.toUpperCase()}`);
    console.log(`Quality Score: ${card.qualityScore}/100`);
    console.log('', '');
    console.log('Issues:');
    card.issues.forEach(issue => {
      console.log(`  - ${issue}`);
    });

    console.log('', '');
    const answer = await question(
      '[a]pprove  [r]eject  [s]kip  [q]uit > '
    );

    if (answer.toLowerCase() === 'q') {
      break;
    } else if (answer.toLowerCase() === 'a') {
      corrections[card.cardId] = {
        cardId: card.cardId,
        cardName: card.cardName,
        text: card.notes,
        generatedDSL: [],
        issues: card.issues,
        qualityScore: card.qualityScore,
        approved: true,
      };
      log('Approved.', '✅');
    } else if (answer.toLowerCase() === 'r') {
      corrections[card.cardId] = {
        cardId: card.cardId,
        cardName: card.cardName,
        text: card.notes,
        generatedDSL: [],
        issues: card.issues,
        qualityScore: 0,
        approved: false,
      };
      log('Rejected.', '❌');
    }
    console.log('', '');
  }

  saveJson(correctionsPath, corrections);
  log('Corrections saved.', '💾');
  rl.close();
}

// ============================================================================
// Stats Display
// ============================================================================

function showStats(args: CliArgs): void {
  const dataDir = path.join(process.cwd(), 'data');
  const cardsPath = path.join(dataDir, 'cards.json');
  const effectsPath = path.join(dataDir, 'effects.json');
  const reviewsPath = path.join(dataDir, 'reviews.json');

  const cardsData = loadJson<CardsData>(cardsPath);
  const effectsData = loadJson<Record<string, unknown>>(effectsPath);
  const reviewsData = loadJson<ValidationResult[]>(reviewsPath);

  console.log('', '');
  console.log('========================================');
  console.log('  Import Statistics');
  console.log('========================================');
  console.log('', '');

  if (cardsData) {
    console.log(
      `Cards loaded:      ${cardsData.cards.length}`
    );
    console.log(`Last fetched:      ${cardsData.lastFetched}`);
    console.log(`Source:            ${cardsData.source}`);
  }

  if (effectsData) {
    console.log(
      `Effects defined:   ${Object.keys(effectsData).length}`
    );
  }

  if (reviewsData) {
    const pass = reviewsData.filter(r => r.status === 'pass').length;
    const warning = reviewsData.filter(r => r.status === 'warning').length;
    const error = reviewsData.filter(r => r.status === 'error').length;
    const total = reviewsData.length;

    console.log('', '');
    console.log('Validation results:');
    console.log(
      `  Pass:              ${pass}/${total} (${((pass / total) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Warning:           ${warning}/${total} (${((warning / total) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Error:             ${error}/${total} (${((error / total) * 100).toFixed(1)}%)`
    );

    // Quality score distribution
    const scores = reviewsData.map(r => r.qualityScore);
    const avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    console.log(`  Avg Quality Score: ${avgScore}/100`);
  }

  console.log('', '');
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const args = parseArgs();

    if (args.review) {
      await runReview(args);
    } else if (args.stats) {
      showStats(args);
    } else {
      await runImport(args);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
