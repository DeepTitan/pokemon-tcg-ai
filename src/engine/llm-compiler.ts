/**
 * LLMEffectCompiler - Uses Claude to convert card text to our effect DSL.
 *
 * For cards where regex pattern matching fails, we send the card text to Claude
 * with our DSL schema and get back a structured effect definition.
 *
 * This runs ONCE during card import, results are cached permanently.
 */

// @ts-ignore
import Anthropic from '@anthropic-ai/sdk';
import { EffectDSL, AttackDefinition, TrainerDefinition } from './effects.js';
import { EnergyType, TrainerType } from './types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CompileRequest {
  cardName: string;
  cardType: 'attack' | 'trainer' | 'ability';
  text: string;
  attackName?: string;
  attackCost?: string[];
  attackDamage?: string;
}

export interface CompileResult {
  success: boolean;
  effects: EffectDSL[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  needsReview: boolean;
  rawResponse?: string;
}

interface CacheEntry {
  request: CompileRequest;
  result: CompileResult;
  compiledAt: string;
}

// ============================================================================
// LLMEffectCompiler Class
// ============================================================================

export class LLMEffectCompiler {
  private client: Anthropic;
  private cache: Map<string, CompileResult> = new Map();
  private cacheFilePath?: string;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Generate a cache key for a compile request
   */
  private getCacheKey(request: CompileRequest): string {
    return `${request.cardName}:${request.cardType}:${request.attackName || 'default'}`;
  }

  /**
   * Compile a single card effect
   */
  async compile(request: CompileRequest): Promise<CompileResult> {
    const cacheKey = this.getCacheKey(request);

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(request);

      const response = await this.client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      const result = this.parseResponse(content.text);
      result.rawResponse = content.text;

      // Cache the result
      this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      console.error(`Failed to compile ${request.cardName}:`, error);
      return {
        success: false,
        effects: [],
        confidence: 'low',
        reasoning: `Error during compilation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        needsReview: true,
      };
    }
  }

  /**
   * Compile multiple cards in batch with concurrency control
   */
  async compileBatch(
    requests: CompileRequest[],
    options?: {
      concurrency?: number;
      onProgress?: (done: number, total: number) => void;
    }
  ): Promise<Map<string, CompileResult>> {
    const concurrency = options?.concurrency || 5;
    const results = new Map<string, CompileResult>();
    const pending = [...requests];
    const inProgress: Promise<void>[] = [];
    let completed = 0;

    while (pending.length > 0 || inProgress.length > 0) {
      // Start new compilations up to concurrency limit
      while (inProgress.length < concurrency && pending.length > 0) {
        const request = pending.shift()!;
        const cacheKey = this.getCacheKey(request);

        const promise = this.compile(request)
          .then(result => {
            results.set(cacheKey, result);
            completed++;
            options?.onProgress?.(completed, requests.length);
          })
          .catch(err => {
            console.error(`Compilation failed for ${request.cardName}:`, err);
            results.set(cacheKey, {
              success: false,
              effects: [],
              confidence: 'low',
              reasoning: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
              needsReview: true,
            });
            completed++;
            options?.onProgress?.(completed, requests.length);
          });

        inProgress.push(promise);
      }

      // Wait for at least one to complete
      if (inProgress.length > 0) {
        await Promise.race(inProgress);
        inProgress.splice(
          inProgress.findIndex(p => p === inProgress[0]), 1
        );
      }
    }

    return results;
  }

  /**
   * Build the system prompt with DSL schema and examples
   */
  private buildSystemPrompt(): string {
    return `You are an expert Pokemon Trading Card Game effect parser. Your job is to convert card text into a structured Effect DSL (Domain Specific Language).

## Effect DSL Types

The effects system supports these base effect types:

### Damage & Combat
- draw: Draw cards. Fields: amount (number)
- damageBonus: Bonus damage. Fields: amount (number), condition? (string)
- damageToSelf: Damage to your own Pokemon. Fields: amount (number)
- damageCounters: Place damage counters. Fields: amount (number), target (string)

### Status & Conditions
- addStatus: Add a status condition. Fields: status (asleep|burned|confused|paralyzed|poisoned), target (self|opponent)
- preventDamage: Block damage. Fields: amount (number), target (self|opponent), duration? (turns)
- conditional: Conditional effect with branches. Fields: condition (object), onTrue (EffectDSL[]), onFalse? (EffectDSL[])

### Energy Management
- discard: Discard cards/energy. Fields: target (self|opponent), amount (number), filter? (object)
- discardEnergy: Discard specific energy types. Fields: target (self|opponent), amount (number), energyType? (string)

### Deck & Search
- search: Search deck. Fields: target (self|opponent), amount (number), filter? (string)
- mill: Discard from opponent's deck top. Fields: target (opponent), amount (number)

### Movement & Switching
- switchActive: Switch active Pokemon. Fields: target (self|opponent)
- retreat: Force retreat. Fields: target (opponent), cost? (number)

### Healing
- heal: Restore HP. Fields: target (self|opponent), amount (number)
- removeStatus: Clear status conditions. Fields: target (self|opponent), status? (string)

### Repeat & Special
- repeatEffect: Effect that repeats based on condition. Fields: repeatCondition (object), effectPerSuccess (EffectDSL)
- limitedUse: One-time effect. Fields: uses (number), duration? (string)
- placeholder: Unknown effect requiring review. Fields: text (string)

## Example Mappings

Card 1: Bulbasaur Attack "Vine Whip"
Text: "Draw 1 card."
Output: [{"type": "draw", "amount": 1}]

Card 2: Charizard Attack "Flame Burst"
Text: "Discard a Fire Energy from this Pokemon. This attack does 30 more damage for each Fire Energy you discarded."
Output: [
  {"type": "discardEnergy", "target": "self", "amount": 1, "energyType": "fire"},
  {"type": "damageBonus", "amount": 30, "condition": "per discarded fire energy"}
]

Card 3: Blastoise Attack "Bubble Bomb"
Text: "Flip a coin. If heads, your opponent's Active Pokemon is now Paralyzed."
Output: [
  {
    "type": "conditional",
    "condition": {"type": "coin", "result": "heads"},
    "onTrue": [{"type": "addStatus", "status": "paralyzed", "target": "opponent"}]
  }
]

Card 4: Machamp Attack "Dynamic Punch"
Text: "Flip 2 coins. This attack does 30 damage for each heads."
Output: [
  {
    "type": "repeatEffect",
    "repeatCondition": {"type": "coinFlip", "count": 2},
    "effectPerSuccess": {"type": "damageBonus", "amount": 30}
  }
]

Card 5: Dragonite Attack "Hurricane"
Text: "This attack does 10 damage to 1 of your opponent's Benched Pokemon."
Output: [
  {"type": "damageCounters", "amount": 1, "target": "opponent's benched"}
]

Card 6: Articuno Ability "Blizzard"
Text: "During your opponent's turn, prevent all damage done to this Pokemon."
Output: [
  {"type": "preventDamage", "amount": 999, "target": "self", "duration": "opponent's turn"}
]

Card 7: Alakazam Trainer "Pokemon Center"
Text: "Heal 30 damage from each of your Pokemon."
Output: [
  {"type": "heal", "target": "all", "amount": 30}
]

Card 8: Gardevoir Attack "Future Sight"
Text: "Search your deck for up to 2 cards and put them into your hand. Shuffle your deck."
Output: [
  {"type": "search", "target": "self", "amount": 2, "filter": "any"}
]

Card 9: Gengar Attack "Shadow Tag"
Text: "Switch 1 of your opponent's Benched Pokemon with their Active Pokemon."
Output: [
  {"type": "switchActive", "target": "opponent"}
]

Card 10: Arcanine Attack "Wild Tackle"
Text: "This Pokemon also does 10 damage to itself."
Output: [
  {"type": "damageToSelf", "amount": 10}
]

## Response Format

Return a JSON object with this structure:
{
  "success": true|false,
  "effects": [array of EffectDSL objects],
  "confidence": "high"|"medium"|"low",
  "reasoning": "Your explanation of how you parsed the effect",
  "needsReview": true|false
}

### Confidence Levels
- high: Clear, unambiguous mapping to standard Pokemon TCG mechanics
- medium: Reasonable interpretation but some ambiguity in wording
- low: Uncertain interpretation, may need human review

### needsReview Flag
Set to true if:
- The effect text is ambiguous or contradictory
- The effect has complex timing interactions
- The effect introduces mechanics not in standard examples
- Multiple valid interpretations exist

## Important Rules

1. Parse all effect text into appropriate DSL effects
2. When text contains multiple sentences/clauses, parse each into separate effects
3. Use placeholder type ONLY for genuinely unparseable text
4. For conditional effects, extract the condition clearly (coin flip, etc.)
5. Preserve numeric values exactly as written
6. When damage modifiers reference conditions, encode them in the damageBonus effect
7. Handle "this Pokemon" and "opponent's Pokemon" targets carefully
8. For effects with "up to X", preserve the "up to" semantics in the filter/amount
9. Always respond with valid JSON only - no markdown, no extra text`;
  }

  /**
   * Build the user prompt for a specific card
   */
  private buildUserPrompt(request: CompileRequest): string {
    let prompt = `Parse this Pokemon TCG card effect into the Effect DSL:\n\n`;
    prompt += `Card Name: ${request.cardName}\n`;
    prompt += `Card Type: ${request.cardType}\n`;

    if (request.attackName) {
      prompt += `Attack Name: ${request.attackName}\n`;
    }

    if (request.attackCost && request.attackCost.length > 0) {
      prompt += `Attack Cost: ${request.attackCost.join(', ')}\n`;
    }

    if (request.attackDamage) {
      prompt += `Base Damage: ${request.attackDamage}\n`;
    }

    prompt += `\nEffect Text:\n"${request.text}"\n\n`;
    prompt += `Return ONLY valid JSON matching the CompileResult format. No markdown, no explanation.`;

    return prompt;
  }

  /**
   * Parse Claude's response into structured effects
   */
  private parseResponse(responseText: string): CompileResult {
    try {
      // Extract JSON from response (handle markdown code blocks if present)
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);  // Remove ```json
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);  // Remove ```
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);  // Remove trailing ```
      }

      const parsed = JSON.parse(jsonText);

      return {
        success: parsed.success ?? true,
        effects: parsed.effects || [],
        confidence: parsed.confidence || 'medium',
        reasoning: parsed.reasoning || 'Parsed successfully',
        needsReview: parsed.needsReview ?? false,
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      console.error('Response text:', responseText);

      return {
        success: false,
        effects: [],
        confidence: 'low',
        reasoning: `Failed to parse response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        needsReview: true,
      };
    }
  }

  /**
   * Save compilation cache to file
   */
  async saveCache(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const cacheData: CacheEntry[] = Array.from(this.cache.entries()).map(
      ([key, result]) => ({
        request: {
          cardName: key.split(':')[0],
          cardType: (key.split(':')[1] as any) || 'attack',
          text: '',  // We don't store full text in key
          attackName: key.split(':')[2] || undefined,
        },
        result,
        compiledAt: new Date().toISOString(),
      })
    );

    await fs.writeFile(filePath, JSON.stringify(cacheData, null, 2));
    console.log(`LLM compilation cache saved to ${filePath}`);
  }

  /**
   * Load compilation cache from file
   */
  async loadCache(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const cacheData: CacheEntry[] = JSON.parse(content);

      for (const entry of cacheData) {
        const key = this.getCacheKey(entry.request);
        this.cache.set(key, entry.result);
      }

      console.log(`Loaded ${cacheData.length} entries from LLM cache`);
    } catch (error) {
      console.warn(`Failed to load LLM cache from ${filePath}:`, error);
    }
  }

  /**
   * Get current cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get a cached result if it exists
   */
  getCached(request: CompileRequest): CompileResult | undefined {
    return this.cache.get(this.getCacheKey(request));
  }
}

// ============================================================================
// Utility Functions for Working with Compiled Effects
// ============================================================================

/**
 * Convert CompileResult to AttackDefinition
 */
export function compileResultToAttackDef(
  result: CompileResult,
  attackName: string,
  cost: EnergyType[],
  baseDamage: number
): AttackDefinition {
  return {
    name: attackName,
    cost,
    baseDamage,
    effects: result.effects,
    description: '',
  };
}

/**
 * Convert CompileResult to TrainerDefinition
 */
export function compileResultToTrainerDef(
  result: CompileResult,
  trainerName: string
): TrainerDefinition {
  return {
    name: trainerName,
    trainerType: TrainerType.Item,
    effects: result.effects,
    description: '',
  };
}

/**
 * Filter compile results by confidence level
 */
export function filterByConfidence(
  results: Map<string, CompileResult>,
  confidence: 'high' | 'medium' | 'low'
): Map<string, CompileResult> {
  const filtered = new Map<string, CompileResult>();

  for (const [key, result] of results) {
    if (result.confidence === confidence) {
      filtered.set(key, result);
    }
  }

  return filtered;
}

/**
 * Get all results that need human review
 */
export function getReviewNeeded(
  results: Map<string, CompileResult>
): Map<string, CompileResult> {
  const needsReview = new Map<string, CompileResult>();

  for (const [key, result] of results) {
    if (result.needsReview || !result.success) {
      needsReview.set(key, result);
    }
  }

  return needsReview;
}

/**
 * Generate a human-readable report of compilation results
 */
export function generateReport(results: Map<string, CompileResult>): string {
  const total = results.size;
  const successful = Array.from(results.values()).filter(r => r.success).length;
  const highConfidence = Array.from(results.values()).filter(
    r => r.confidence === 'high'
  ).length;
  const needsReview = Array.from(results.values()).filter(
    r => r.needsReview
  ).length;

  let report = `\n=== LLM Effect Compilation Report ===\n`;
  report += `Total compiled: ${total}\n`;
  report += `Successful: ${successful} (${((successful / total) * 100).toFixed(1)}%)\n`;
  report += `High confidence: ${highConfidence} (${((highConfidence / total) * 100).toFixed(1)}%)\n`;
  report += `Needs review: ${needsReview}\n`;

  if (needsReview > 0) {
    report += `\nCards needing review:\n`;
    for (const [key, result] of results) {
      if (result.needsReview) {
        report += `  - ${key}: ${result.reasoning}\n`;
      }
    }
  }

  return report;
}
