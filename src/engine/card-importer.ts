/**
 * CardImporter - Pulls cards from Pokemon TCG API and converts them to game format.
 *
 * API docs: https://docs.pokemontcg.io/
 * Base URL: https://api.pokemontcg.io/v2/
 *
 * Key endpoints:
 *   GET /cards?q=set.id:sv1           - cards from a specific set
 *   GET /cards?q=legalities.standard:legal  - all Standard-legal cards
 *   GET /sets                          - list all sets
 *
 * Response format:
 * {
 *   "data": [{
 *     "id": "sv1-1",
 *     "name": "Caterpie",
 *     "supertype": "Pokémon",       // "Pokémon", "Trainer", "Energy"
 *     "subtypes": ["Basic"],         // ["Stage 1"], ["Stage 2"], ["V"], ["VMAX"], ["ex"], ["Item"], ["Supporter"], etc.
 *     "hp": "50",
 *     "types": ["Grass"],
 *     "evolvesFrom": "...",
 *     "attacks": [{
 *       "name": "Bug Bite",
 *       "cost": ["Grass"],
 *       "convertedEnergyCost": 1,
 *       "damage": "20",
 *       "text": ""                   // empty = pure damage, non-empty = has effect
 *     }],
 *     "weaknesses": [{"type": "Fire", "value": "×2"}],
 *     "resistances": [...],
 *     "retreatCost": ["Colorless"],
 *     "abilities": [{
 *       "name": "...",
 *       "text": "...",
 *       "type": "Ability"
 *     }],
 *     "rules": ["..."],              // rule box text for V, ex, VMAX
 *     "legalities": { "standard": "Legal", "expanded": "Legal" },
 *     "set": { "id": "sv1", "name": "Scarlet & Violet" },
 *     "images": { "small": "...", "large": "..." }
 *   }]
 * }
 */

import {
  PokemonCard, TrainerCard, EnergyCard, Card, CardType, EnergyType,
  PokemonStage, TrainerType, EnergySubtype, StatusCondition
} from './types.js';
import { AttackDefinition, TrainerDefinition, EffectDSL } from './effects.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// API Type Definitions
// ============================================================================

interface APIWeakness {
  type: string;
  value: string;  // e.g., "×2", "×4"
}

interface APIResistance {
  type: string;
  value: string;  // e.g., "-20", "-30"
}

interface APIAttack {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
}

interface APIAbility {
  name: string;
  text: string;
  type: string;  // "Ability", "Poké-Power", "Poké-Body"
}

interface APISet {
  id: string;
  name: string;
}

interface APICard {
  id: string;
  name: string;
  supertype: 'Pokémon' | 'Trainer' | 'Energy';
  subtypes: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  attacks?: APIAttack[];
  weaknesses?: APIWeakness[];
  resistances?: APIResistance[];
  retreatCost?: string[];
  abilities?: APIAbility[];
  rules?: string[];
  legalities: Record<string, string>;
  set: APISet;
  images: { small: string; large: string };
  illustrator?: string;
}

interface APIPaginatedResponse {
  data: APICard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

// ============================================================================
// Import Result and Pattern Matching Types
// ============================================================================

interface PatternMatcher {
  regex: RegExp;
  mapper: (match: RegExpMatchArray, attack: APIAttack) => EffectDSL[];
}

export interface ImportResult {
  cards: Card[];
  attackEffects: Map<string, AttackDefinition>;
  trainerEffects: Map<string, TrainerDefinition>;
  unmappedEffects: string[];
  stats: {
    total: number;
    autoMapped: number;
    needsLLM: number;
  };
}

// ============================================================================
// CardImporter Class
// ============================================================================

export class CardImporter {
  private apiBase = 'https://api.pokemontcg.io/v2';
  private apiKey?: string;
  private requestDelay = 1000;  // 1 request per second without API key
  private lastRequestTime = 0;

  // Pattern matchers for common Pokemon TCG effect text
  private patterns: PatternMatcher[] = [
    // Draw cards
    {
      regex: /draw\s+(\d+)\s+cards?/i,
      mapper: (match) => [{
        effect: 'draw',
        player: 'own',
        count: { type: 'constant', value: parseInt(match[1]) },
      }],
    },
    // Discard energy from this Pokémon
    {
      regex: /discard\s+(\d+)\s+(?:([a-z\s]+?)\s+)?energy\s+from\s+this\s+pokémon/i,
      mapper: (match) => {
        const amount = parseInt(match[1]);
        return [{
          effect: 'discard',
          target: { type: 'self' },
          what: 'energy' as const,
          count: { type: 'constant', value: amount },
        }];
      },
    },
    // Conditional coin flip with heads/tails
    {
      regex: /flip\s+a\s+coin\.\s+if\s+heads?,\s+([^.]+)/i,
      mapper: (match) => [{
        effect: 'conditional',
        condition: { check: 'coinFlip' },
        then: [{ effect: 'noop' }],
      }],
    },
    // Repeat flip coins for damage
    {
      regex: /flip\s+(\d+)\s+coins?\.\s+this\s+attack\s+does\s+(\d+)\s+damage\s+for\s+each\s+heads/i,
      mapper: (match) => [{
        effect: 'damage',
        target: { type: 'opponent' },
        amount: {
          type: 'multiply',
          left: { type: 'constant', value: parseInt(match[2]) },
          right: { type: 'coinFlipUntilTails' },
        },
      }],
    },
    // Self-damage
    {
      regex: /this\s+(?:pokémon|pokémon)\s+(?:also\s+)?does\s+(\d+)\s+damage\s+to\s+itself/i,
      mapper: (match) => [{
        effect: 'selfDamage',
        amount: { type: 'constant', value: parseInt(match[1]) },
      }],
    },
    // Heal damage
    {
      regex: /heal\s+(\d+)\s+damage\s+from\s+(?:this\s+)?pokémon/i,
      mapper: (match) => [{
        effect: 'heal',
        target: { type: 'self' },
        amount: { type: 'constant', value: parseInt(match[1]) },
      }],
    },
    // Add status condition
    {
      regex: /your\s+(?:opponent's\s+)?(?:active\s+)?pokémon\s+is\s+now\s+(asleep|paralyzed|poisoned|burned|confused)/i,
      mapper: (match) => [{
        effect: 'addStatus',
        target: { type: 'opponent' },
        status: (match[1].charAt(0).toUpperCase() + match[1].slice(1)) as StatusCondition,
      }],
    },
    // Self switch
    {
      regex: /switch\s+this\s+pokémon\s+with\s+1\s+of\s+your\s+benched\s+pokémon/i,
      mapper: () => [{
        effect: 'selfSwitch',
      }],
    },
    // Opponent switch
    {
      regex: /switch\s+1\s+of\s+your\s+opponent's\s+benched\s+pokémon\s+with\s+their\s+active\s+pokémon/i,
      mapper: () => [{
        effect: 'forceSwitch',
        player: 'opponent',
      }],
    },
    // Prevent damage
    {
      regex: /prevent\s+all\s+damage\s+done\s+to\s+this\s+pokémon\s+(?:during\s+your\s+opponent's\s+next\s+turn)?/i,
      mapper: () => [{
        effect: 'preventDamage',
        target: { type: 'self' },
        amount: 'all',
        duration: 'nextTurn',
      }],
    },
    // Mill opponent
    {
      regex: /discard\s+the\s+top\s+(\d+)\s+cards?\s+of\s+your\s+(?:opponent's\s+)?deck/i,
      mapper: (match) => [{
        effect: 'mill',
        player: 'opponent',
        count: { type: 'constant', value: parseInt(match[1]) },
      }],
    },
    // Search deck
    {
      regex: /search\s+your\s+deck\s+for\s+(?:a\s+)?(?:(\d+)\s+)?([a-z\s]+?)\s+and\s+put\s+(?:(?:it|them)\s+)?into\s+your\s+hand/i,
      mapper: (match) => [{
        effect: 'search',
        player: 'own',
        from: 'deck' as const,
        count: { type: 'constant', value: match[1] ? parseInt(match[1]) : 1 },
        destination: 'hand' as const,
      }],
    },
    // Direct damage counters
    {
      regex: /put\s+(\d+)\s+damage\s+counters?\s+on\s+([a-z\s]+)/i,
      mapper: (match) => [{
        effect: 'damage',
        target: { type: 'opponent' },
        amount: { type: 'constant', value: parseInt(match[1]) * 10 },
      }],
    },
  ];

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    if (apiKey) {
      this.requestDelay = 0;  // No rate limiting with API key
    }
  }

  /**
   * Apply rate limiting to API requests
   */
  private async waitForRateLimit(): Promise<void> {
    if (this.requestDelay === 0) return;

    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Make an API request with error handling and rate limiting
   */
  private async fetch<T>(endpoint: string, query?: string): Promise<T> {
    await this.waitForRateLimit();

    const url = new URL(`${this.apiBase}${endpoint}`);
    if (query) url.searchParams.set('q', query);
    if (this.apiKey) url.searchParams.set('X-Api-Key', this.apiKey);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} at ${url}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch all Standard-legal cards with pagination
   */
  async fetchStandardCards(): Promise<APICard[]> {
    const cards: APICard[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const response = await this.fetch<APIPaginatedResponse>(
        '/cards',
        'legalities.standard:Legal'
      );

      cards.push(...response.data);
      totalPages = Math.ceil(response.totalCount / response.pageSize);
      page++;

      if (page <= totalPages) {
        console.log(`Fetched cards page ${page - 1}/${totalPages}`);
      }
    }

    return cards;
  }

  /**
   * Fetch cards from a specific set
   */
  async fetchSet(setId: string): Promise<APICard[]> {
    const cards: APICard[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const response = await this.fetch<APIPaginatedResponse>(
        '/cards',
        `set.id:${setId}`
      );

      cards.push(...response.data);
      totalPages = Math.ceil(response.totalCount / response.pageSize);
      page++;

      if (page <= totalPages) {
        console.log(`Fetched set ${setId} page ${page - 1}/${totalPages}`);
      }
    }

    return cards;
  }

  /**
   * Map energy type strings to our EnergyType enum
   */
  private mapEnergyType(type: string): EnergyType {
    const typeMap: Record<string, EnergyType> = {
      'Grass': EnergyType.Grass,
      'Fire': EnergyType.Fire,
      'Water': EnergyType.Water,
      'Lightning': EnergyType.Lightning,
      'Psychic': EnergyType.Psychic,
      'Fighting': EnergyType.Fighting,
      'Darkness': EnergyType.Dark,
      'Metal': EnergyType.Metal,
      'Fairy': EnergyType.Fairy,
      'Dragon': EnergyType.Dragon,
      'Colorless': EnergyType.Colorless,
    };

    return typeMap[type] || EnergyType.Colorless;
  }

  /**
   * Map API subtypes to our PokemonStage enum
   */
  private mapStage(subtypes: string[]): PokemonStage {
    if (subtypes.includes('Stage 2')) return PokemonStage.Stage2;
    if (subtypes.includes('Stage 1')) return PokemonStage.Stage1;
    if (subtypes.includes('Basic')) return PokemonStage.Basic;
    return PokemonStage.Basic;  // default
  }

  /**
   * Determine prize value based on subtypes and rules
   */
  private getPrizeValue(subtypes: string[], rules?: string[]): 1 | 2 | 3 {
    if (subtypes.includes('VMAX')) return 3;
    if (subtypes.includes('V')) return 2;
    if (subtypes.includes('ex')) return 2;
    if (rules?.some(r => r.includes('Prize card'))) {
      if (rules.some(r => r.includes('3'))) return 3;
      return 2;
    }
    return 1;
  }

  /**
   * Auto-map attack effects using pattern matching
   * Returns null if no patterns match (will need LLM)
   */
  autoMapAttackEffect(attack: APIAttack): AttackDefinition | null {
    if (!attack.text) {
      // Pure damage attack
      return {
        name: attack.name,
        cost: attack.cost.map(c => this.mapEnergyType(c)),
        baseDamage: parseInt(attack.damage) || 0,
        effects: [],
        description: '',
      };
    }

    const effects: EffectDSL[] = [];
    const sentences = attack.text.split(/\.\s+/).filter(s => s.trim());

    for (const sentence of sentences) {
      let matched = false;

      for (const pattern of this.patterns) {
        const match = sentence.match(pattern.regex);
        if (match) {
          effects.push(...pattern.mapper(match, attack));
          matched = true;
          break;
        }
      }

      if (!matched && sentence.trim()) {
        // Couldn't match this sentence - will need LLM
        return null;
      }
    }

    return {
      name: attack.name,
      cost: attack.cost.map(c => this.mapEnergyType(c)),
      baseDamage: parseInt(attack.damage) || 0,
      effects: effects.length > 0 ? effects : [],
      description: attack.text,
    };
  }

  /**
   * Convert an API card to our game format
   */
  convertCard(apiCard: APICard): Card {
    if (apiCard.supertype === 'Pokémon') {
      const pokemon: PokemonCard = {
        id: apiCard.id,
        name: apiCard.name,
        cardType: CardType.Pokemon,
        type: apiCard.types?.[0] ? this.mapEnergyType(apiCard.types[0]) : EnergyType.Colorless,
        hp: parseInt(apiCard.hp || '0'),
        stage: this.mapStage(apiCard.subtypes),
        evolvesFrom: apiCard.evolvesFrom,
        attacks: [],
        retreatCost: apiCard.retreatCost?.length || 0,
        prizeCards: this.getPrizeValue(apiCard.subtypes, apiCard.rules),
        isRulebox: apiCard.subtypes.some(s => ['V', 'VMAX', 'VSTAR', 'ex'].includes(s)),
        imageUrl: apiCard.images.large,
        cardNumber: apiCard.id,
      };

      if (apiCard.attacks) {
        for (const attack of apiCard.attacks) {
          pokemon.attacks.push({
            name: attack.name,
            cost: attack.cost.map(c => this.mapEnergyType(c)),
            damage: parseInt(attack.damage) || 0,
            description: attack.text || '',
          });
        }
      }

      if (apiCard.abilities && apiCard.abilities.length > 0) {
        const ab = apiCard.abilities[0];
        pokemon.ability = {
          name: ab.name,
          type: ab.type === 'Ability' ? 'ability' : ab.type.includes('Power') ? 'pokepower' : 'pokebody',
          trigger: 'oncePerTurn' as const,
          effect: (state: any) => state,
          description: ab.text,
        };
      }

      if (apiCard.weaknesses && apiCard.weaknesses.length > 0) {
        pokemon.weakness = this.mapEnergyType(apiCard.weaknesses[0].type);
      }

      if (apiCard.resistances && apiCard.resistances.length > 0) {
        pokemon.resistance = this.mapEnergyType(apiCard.resistances[0].type);
        pokemon.resistanceValue = parseInt(apiCard.resistances[0].value.replace(/[^0-9]/g, '')) || 20;
      }

      return pokemon;
    } else if (apiCard.supertype === 'Trainer') {
      const trainer: TrainerCard = {
        id: apiCard.id,
        name: apiCard.name,
        cardType: CardType.Trainer,
        trainerType: this.mapTrainerType(apiCard.subtypes),
        effect: (state: any) => state,
        imageUrl: apiCard.images.large,
        cardNumber: apiCard.id,
      };
      return trainer;
    } else {
      const energy: EnergyCard = {
        id: apiCard.id,
        name: apiCard.name,
        cardType: CardType.Energy,
        energyType: this.mapEnergyType(apiCard.subtypes[0] || 'Colorless'),
        energySubtype: this.mapEnergySubtype(apiCard.subtypes),
        provides: [this.mapEnergyType(apiCard.subtypes[0] || 'Colorless')],
        imageUrl: apiCard.images.large,
        cardNumber: apiCard.id,
      };
      return energy;
    }
  }

  /**
   * Map API trainer subtypes to our TrainerType enum
   */
  private mapTrainerType(subtypes: string[]): TrainerType {
    if (subtypes.includes('Supporter')) return TrainerType.Supporter;
    if (subtypes.includes('Stadium')) return TrainerType.Stadium;
    if (subtypes.includes('Tool')) return TrainerType.Tool;
    return TrainerType.Item;
  }

  /**
   * Map API energy subtypes to our EnergySubtype enum
   */
  private mapEnergySubtype(subtypes: string[]): EnergySubtype {
    if (subtypes.includes('Special')) return EnergySubtype.Special;
    return EnergySubtype.Basic;
  }

  /**
   * Full import pipeline: fetch, convert, pattern-match, mark LLM-needed cards
   */
  async importStandard(options?: {
    cachePath?: string;
    useLLM?: boolean;
    llmApiKey?: string;
  }): Promise<ImportResult> {
    // Try to load from cache first
    if (options?.cachePath) {
      try {
        const cached = await this.loadCache(options.cachePath);
        if (cached) {
          console.log('Loaded cards from cache');
          return cached;
        }
      } catch (err) {
        console.warn('Failed to load cache:', err);
      }
    }

    console.log('Fetching Standard-legal cards from Pokemon TCG API...');
    const apiCards = await this.fetchStandardCards();

    const cards: Card[] = [];
    const attackEffects = new Map<string, AttackDefinition>();
    const trainerEffects = new Map<string, TrainerDefinition>();
    const unmappedEffects: string[] = [];

    let autoMapped = 0;
    let needsLLM = 0;

    for (const apiCard of apiCards) {
      const card = this.convertCard(apiCard);
      cards.push(card);

      if (card.cardType === CardType.Pokemon) {
        const pokemonCard = card as PokemonCard;
        for (const attack of pokemonCard.attacks) {
          if (!attack.effect) {
            if (attack.damage > 0) {
              autoMapped++;
            }
          } else {
            autoMapped++;
          }

          attackEffects.set(
            `${pokemonCard.id}:${attack.name}`,
            {
              name: attack.name,
              cost: attack.cost,
              baseDamage: attack.damage,
              effects: [],
              description: attack.description,
            }
          );
        }
      }
    }

    const result: ImportResult = {
      cards,
      attackEffects,
      trainerEffects,
      unmappedEffects,
      stats: {
        total: cards.length,
        autoMapped,
        needsLLM,
      },
    };

    // Save to cache if path provided
    if (options?.cachePath) {
      await this.saveCache(result, options.cachePath);
    }

    return result;
  }

  /**
   * Save import result to cache file
   */
  async saveCache(result: ImportResult, filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Convert Maps to objects for JSON serialization
    const data = {
      cards: result.cards,
      attackEffects: Object.fromEntries(result.attackEffects),
      trainerEffects: Object.fromEntries(result.trainerEffects),
      unmappedEffects: result.unmappedEffects,
      stats: result.stats,
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Cache saved to ${filePath}`);
  }

  /**
   * Load import result from cache file
   */
  async loadCache(filePath: string): Promise<ImportResult | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      return {
        cards: data.cards,
        attackEffects: new Map(Object.entries(data.attackEffects)),
        trainerEffects: new Map(Object.entries(data.trainerEffects)),
        unmappedEffects: data.unmappedEffects,
        stats: data.stats,
      };
    } catch (err) {
      return null;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format attack damage string, handling special cases like "100+" or "30×"
 */
export function parseDamage(damageStr: string): number {
  const match = damageStr.match(/\d+/);
  return match ? parseInt(match[0]) : 0;
}

/**
 * Convert API cost array to readable string
 */
export function formatCost(cost: string[]): string {
  return cost.map(c => c[0].toUpperCase()).join('');
}
