# Pokemon TCG AI - Card Import Guide

This guide explains how to use the card import pipeline to pull all Standard-legal Pokemon TCG cards, compile their effects, validate them, and generate a review report.

## Quick Start

The simplest way to run the import pipeline:

```bash
npm run import-cards
```

This runs the complete import pipeline in order:
1. Fetches cards from Pokemon TCG API (or loads from cache if fresh)
2. Auto-maps simple effects using pattern matching
3. Sends complex effects to Claude for compilation (if ANTHROPIC_API_KEY is set)
4. Validates all effects
5. Generates a comprehensive report

## Command-Line Options

### Basic Usage

```bash
# Full pipeline (default)
npm run import-cards

# Specific set only
npm run import-cards -- --set sv7

# Skip LLM compilation (pattern matching only)
npm run import-cards -- --skip-llm

# Force re-fetch (don't use cache)
npm run import-cards -- --force

# Review flagged cards interactively
npm run import-cards -- --review

# Show detailed statistics
npm run import-cards -- --stats

# Force recompile all effects
npm run import-cards -- --force-recompile
```

### Combining Options

```bash
# Import specific set, skip LLM
npm run import-cards -- --set sv7 --skip-llm

# Import with fresh data and force LLM recompilation
npm run import-cards -- --force --force-recompile
```

## Environment Variables

### Optional: Pokemon TCG API Key
```bash
export POKEMON_TCG_API_KEY=your_api_key
```
- Increases API rate limits from 1 request/sec to unlimited
- Optional but recommended for large imports
- Get one at: https://pokemontcg.io/

### Required (for LLM compilation): Anthropic API Key
```bash
export ANTHROPIC_API_KEY=your_anthropic_key
```
- Required to enable Phase 2 LLM compilation
- If not set, LLM phase is skipped and only pattern matching is used
- Get one at: https://console.anthropic.com/

## Pipeline Phases

### Phase 1: Fetch Cards
Pulls Standard-legal cards from the Pokemon TCG API with pagination.

**Output:**
- `data/cards.json` - All fetched card definitions

**What it does:**
- Makes API requests to `https://api.pokemontcg.io/v2/cards`
- Queries for `legalities.standard:Legal`
- Handles pagination automatically
- Converts API format to internal game format

### Phase 2: Pattern Matching (Auto-map Effects)
Uses regex patterns to auto-map simple attack effects without needing LLM.

**Examples of patterns matched:**
- "Draw 2 cards" → draw effect
- "Discard 1 energy from this Pokémon" → discard effect
- "Flip a coin. If heads, paralyze the defending Pokémon" → conditional effect
- "Put 2 damage counters on your opponent's active Pokémon" → damage counters effect

**Metrics:**
```
✅ 847 cards auto-mapped (63%)
⚠️  490 cards need LLM compilation (37%)
```

### Phase 3: LLM Compilation
For cards that don't match patterns, sends them to Claude Opus for compilation.

**What happens:**
- Sends 490 complex card effects to Claude
- Claude uses the Effect DSL schema to generate structured effects
- Results are cached permanently
- Cost estimation: ~$0.003 per card with Haiku (~$1.50 for 490 cards)

**Example output:**
```
🤖 Phase 2: LLM compilation (490 cards)...
[████████░░░░░░░░░░░░░░░░░░░░░░] 27% (132/490)
💰 Estimated API cost: ~$1.50
```

### Phase 4: Validation
Runs static and simulation-based validation on all effects.

**Checks:**
- Attacks have either damage or effects (not both empty)
- Effect types are recognized
- Target selectors are valid
- No placeholders in final effects
- Quality score based on completeness

**Output:**
```
✅ 1,089 cards passed validation (81%)
⚠️  187 cards flagged for review (14%)
❌ 61 cards likely broken (5%)
```

### Phase 5: Apply Corrections
Loads and applies any human corrections from previous runs.

**File:** `data/corrections.json`

This allows you to manually fix broken cards and have those fixes persist across re-runs.

### Phase 6: Generate Report
Creates a comprehensive summary of the import.

**Output files:**
- `data/cards.json` - Card definitions
- `data/effects.json` - Compiled effect definitions
- `data/reviews.json` - Validation results with quality scores
- `data/corrections.json` - Human corrections (persists across runs)
- `data/import-report.txt` - Human-readable summary

## Review Mode

After import, review flagged cards interactively:

```bash
npm run import-cards -- --review
```

This shows each flagged card and lets you:
- `[a]pprove` - Mark as correct
- `[r]eject` - Mark as broken
- `[s]kip` - Skip to next
- `[q]uit` - Exit review

Your decisions are saved to `data/corrections.json` and persist across runs.

Example review session:
```
═══════════════════════════════════════════
Card: Charizard ex (sv3-125)
Status: WARNING
Quality Score: 62/100

Issues:
  - WARNING: Text says "attach them" but effect sends to hand

[a]pprove  [r]eject  [s]kip  [q]uit > a
Approved. ✅
```

## Statistics Mode

View detailed import statistics:

```bash
npm run import-cards -- --stats
```

Example output:
```
========================================
  Import Statistics
========================================

Cards loaded:      1,337
Last fetched:      2026-02-10T12:30:45.123Z
Source:            All Standard-legal cards

Effects defined:   1,276

Validation results:
  Pass:              1,089/1,337 (81.5%)
  Warning:           187/1,337 (14.0%)
  Error:             61/1,337 (4.6%)
  Avg Quality Score: 87.3/100
```

## Output Files

### cards.json
Complete card definitions in JSON format.

```json
{
  "cards": [
    {
      "id": "sv1-1",
      "name": "Bulbasaur",
      "type": "pokemon",
      "hp": 40,
      "energyType": "grass",
      "stage": "basic",
      "attacks": [
        {
          "name": "Vine Whip",
          "cost": ["grass"],
          "baseDamage": 30,
          "effects": []
        }
      ],
      ...
    }
  ],
  "lastFetched": "2026-02-10T12:30:45.123Z",
  "source": "All Standard-legal cards"
}
```

### effects.json
Compiled effect definitions keyed by `cardId:attackName`.

```json
{
  "sv1-1:Vine Whip": {
    "name": "Vine Whip",
    "cost": ["grass"],
    "baseDamage": 30,
    "effects": []
  },
  "sv1-2:Leech Seed": {
    "name": "Leech Seed",
    "cost": ["grass"],
    "baseDamage": 20,
    "effects": [
      {
        "effect": "heal",
        "target": { "type": "self" },
        "amount": { "type": "constant", "value": 20 }
      }
    ]
  }
}
```

### reviews.json
Validation results for each card.

```json
[
  {
    "cardId": "sv1-1",
    "cardName": "Bulbasaur",
    "status": "pass",
    "issues": [],
    "qualityScore": 100,
    "notes": ""
  },
  {
    "cardId": "sv1-25",
    "cardName": "Charizard ex",
    "status": "warning",
    "issues": [
      "WARNING: Text says 'attach them' but effect sends to hand"
    ],
    "qualityScore": 62,
    "notes": ""
  }
]
```

### corrections.json
Persists human corrections across runs.

```json
{
  "sv1-25": {
    "cardId": "sv1-25",
    "cardName": "Charizard ex",
    "approved": true,
    "notes": "Manually reviewed and approved"
  }
}
```

### import-report.txt
Human-readable summary in plain text.

```
========================================
  Pokemon TCG AI - Import Report
========================================

Timestamp: 2026-02-10T12:30:45.123Z

STATISTICS:
  Total cards:           1,337
  Auto-mapped:           847
  LLM compiled:          490
  Validation pass:       1,089 (81%)
  Validation warning:    187 (14%)
  Validation error:      61 (5%)
  Estimated API cost:    $1.50

TOP ISSUES:
  1. Complex conditional effects (23 cards)
  2. Multi-target damage spread (18 cards)
  3. Deck manipulation effects (12 cards)

OUTPUT FILES:
  data/cards.json        (1,337 cards)
  data/effects.json      (1,276 effect definitions)
  data/reviews.json      (validation results)
  data/corrections.json  (human corrections)
  data/import-report.txt (this report)

NEXT STEPS:
  npm run import-cards -- --review    Review flagged cards
  npm run import-cards -- --stats     Show detailed stats
  npm run train                       Start training AI
```

## Caching Behavior

The import script caches card definitions locally to avoid unnecessary API calls.

**Cache freshness:** 24 hours

**Force refresh:**
```bash
npm run import-cards -- --force
```

This will:
- Re-fetch all cards from the API
- Update cached data
- Start fresh import pipeline

## Cost Estimation

### Pokemon TCG API
- Free tier: 1 request/second (no quota limit)
- With API key: Unlimited requests/second
- Typical import of 1,337 cards: ~5 minutes with rate limiting

### Claude API (LLM compilation)
- Model: `claude-opus-4-6` (or Haiku for cost-saving)
- Per-card cost: ~$0.003 (Haiku) to $0.01 (Opus)
- 490 complex effects: ~$1.50 (Haiku) to $5.00 (Opus)
- Cached permanently - runs only once!

**Saving costs:**
```bash
# Skip LLM entirely (pattern matching only)
npm run import-cards -- --skip-llm

# Use cached results (default, no cost)
npm run import-cards
```

## Troubleshooting

### ANTHROPIC_API_KEY not set
```
⚠️ ANTHROPIC_API_KEY not set. Skipping LLM compilation for 490 cards
```

**Solution:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run import-cards
```

### Pokemon TCG API rate limit exceeded
```
❌ Error: API request failed: 429 Too Many Requests
```

**Solution:**
- Get a free API key at https://pokemontcg.io/
- Set `POKEMON_TCG_API_KEY` environment variable
- Wait and retry (rate limit resets after an hour)

### Cache is stale
If import says "Loaded from cache" but you want fresh data:

```bash
npm run import-cards -- --force
```

### Some cards have low quality scores
This is normal! Cards with complex conditional effects or unclear text will have lower scores. Review them:

```bash
npm run import-cards -- --review
```

## Advanced: Understanding the Effect DSL

Effects are represented as JSON structures using a composable DSL:

```typescript
// Simple damage
{ effect: "damage", target: { type: "opponent" }, amount: { type: "constant", value: 30 } }

// Draw cards
{ effect: "draw", player: "own", count: { type: "constant", value: 2 } }

// Conditional effect
{
  effect: "conditional",
  condition: { type: "coinFlip" },
  then: [
    { effect: "addStatus", target: { type: "opponent" }, status: "paralyzed" }
  ]
}

// Heal based on energy attached
{
  effect: "heal",
  target: { type: "self" },
  amount: {
    type: "multiply",
    left: { type: "countEnergy", target: { type: "self" } },
    right: { type: "constant", value: 10 }
  }
}
```

See `src/engine/effects.ts` for the complete DSL specification.

## Next Steps

After successfully importing cards:

1. **Review flagged cards** (optional but recommended):
   ```bash
   npm run import-cards -- --review
   ```

2. **Train the AI** on working cards:
   ```bash
   npm run train
   ```

3. **Play against the AI**:
   ```bash
   npm run play
   ```

## File Locations

```
pokemon-tcg-ai/
├── scripts/
│   └── import-cards.ts          # Main import script
├── src/
│   └── engine/
│       ├── card-importer.ts     # API fetching and pattern matching
│       ├── llm-compiler.ts      # Claude integration
│       ├── effects.ts           # Effect DSL definitions
│       └── types.ts             # Card type definitions
└── data/
    ├── cards.json               # Card definitions (generated)
    ├── effects.json             # Effect definitions (generated)
    ├── reviews.json             # Validation results (generated)
    ├── corrections.json         # Human corrections (generated)
    └── import-report.txt        # Import summary (generated)
```

## Performance Tips

1. **First import takes longer** - subsequent runs use cache
2. **Skip LLM for testing** - use `--skip-llm` for faster iterations
3. **Check stats first** - run `--stats` before `--review` to see what needs work
4. **Import small sets** - test with `--set sv7` before full import
5. **Batch corrections** - make multiple corrections in one review session

## API Documentation

- **Pokemon TCG API:** https://docs.pokemontcg.io/
- **Anthropic Claude:** https://docs.anthropic.com/
- **Our Effect DSL:** See `src/engine/effects.ts`

