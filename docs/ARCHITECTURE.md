# Pokemon TCG AI – Architecture & Game State

This doc explains how the engine works, how card effects (including abilities like Quick Search) are implemented, and where the design could be improved.

---

## 1. Game state – what you have

Your `GameState` is rich and matches the types in `src/engine/types.ts`:

| Area | What’s there | Notes |
|------|----------------|-------|
| **Players** | `deck`, `hand`, `active`, `bench`, `prizes`, `discard`, `lostZone` | Full zones; `prizeCardsRemaining` is the win condition count. |
| **Turn/phase** | `currentPlayer`, `turnNumber`, `phase` | Phases: Setup → DrawPhase → MainPhase → AttackPhase → BetweenTurns → GameOver. |
| **Per-player flags** | `supporterPlayedThisTurn`, `energyAttachedThisTurn`, `abilitiesUsedThisTurn` | Enforce “once per turn” and attachment rules. |
| **Board** | `stadium` | Stadium card in play (e.g. Area Zero Underdepths). |
| **Pokemon in play** | `currentHp`, `attachedEnergy`, `statusConditions`, `damageShields`, `cannotRetreat`, `previousStage` | Enough for damage, evolution, and simple modifiers. |
| **Meta** | `winner`, `turnActions`, `gameLog`, `gameFlags` | Logging and temporary rules (e.g. “opponent can’t attack next turn”). |

So from a game-design perspective, the **state shape** is in good shape: you have zones, phases, turn flags, and in-play tracking. Gaps are mostly in **how** effects are defined and executed, and in a few rule interactions (see below).

---

## 2. How card effects actually work (the fuzzy part)

There are **two separate systems**; only one is used at runtime for the current sim.

### Path A: Hand-coded effect functions (what the sim uses)

- **Where:** Cards in `src/engine/charizard-deck.ts` (and any similar deck files).
- **How it works:**
  - Each **Ability** has:
    - `description`: string (card text, for display only).
    - `effect`: **function** `(state, pokemon, playerIndex) => GameState`.
  - Each **Attack** can have optional `effect`: `(state, attacker, target) => GameState`.
  - Each **Trainer** has `effect`: `(state, player) => GameState`.
- **Quick Search (Pidgeot ex)** is implemented **only** as that function. The engine does **not** read the description string to decide what to do. The function:
  1. Clones the current player’s deck/hand.
  2. Picks a card (heuristic: e.g. Fire Energy, Rare Candy, Supporter, else first).
  3. Moves it to hand, shuffles deck, updates state and `gameLog`.

So: **“Compiler that converts descriptions into effects”** does **not** run at runtime for abilities. The description is display-only; the real behavior is 100% in the hand-coded `effect` function.

### Path B: Effect DSL + LLM compiler (import/validation, not wired for ability runtime)

- **Where:** `src/engine/effects.ts` (EffectDSL, EffectExecutor), `src/engine/llm-compiler.ts`, `src/engine/card-importer.ts`.
- **How it works:**
  - **EffectDSL** is a JSON-friendly language of primitives: `draw`, `search`, `damage`, `heal`, `conditional`, etc.
  - **LLMEffectCompiler** takes card text (e.g. “Search your deck for any 1 card…”) and returns **EffectDSL** (e.g. `search` from deck to hand).
  - **EffectExecutor** can run that DSL and produce a new `GameState`.
- **Where it’s used today:**
  - **Card import:** When you import from the API, abilities get `effect: (state) => state` (no-op). The importer can later use the LLM to produce EffectDSL for attacks/trainers and store it in `attackEffects` / `trainerEffects` maps.
  - **Validation:** `effect-validator.ts` uses EffectExecutor to simulate “if we run this DSL, does the outcome match the card text?” So the compiler is for **generating and validating** effects, not for **running** them in the main game loop.
- **Runtime:** The game engine never calls `EffectExecutor.execute(...)` for abilities. It only calls `ability.effect(state, pokemon, playerIndex)`. So for abilities, the DSL path is **not** connected to the main loop.

Summary:

- **Quick Search** is implemented by a **hand-written function** in `charizard-deck.ts`.
- The **description** is not “compiled” at runtime; it’s for humans/UI.
- The **LLM compiler** turns text → EffectDSL for import/validation; to use it at runtime for abilities you’d need a bridge: e.g. “when UseAbility is applied, if this card has a compiled `EffectDSL`, run EffectExecutor instead of calling `ability.effect`.”

---

## 3. What’s included vs what’s missing (game design)

### Implemented and working

- Phases, turn order, draw step, main phase, attack phase, between turns.
- Legal action generation: play Pokemon, attach energy, play trainer, retreat, use ability (once-per-turn), attack, pass.
- Damage application, weakness/resistance, knockouts, prize taking, deck-out / no active = game over.
- Evolution (including Rare Candy), evolution-triggered abilities (e.g. Infernal Reign, Jewel Seeker).
- Once-per-turn abilities (Quick Search, Flip the Script, etc.) with a heuristic “choice” (e.g. what to search) baked into the effect function.
- Basic attack damage and optional attack effects (e.g. Burning Darkness extra damage).
- Stadium in state; some stadiums may have logic in trainer effects.
- Damage shields and “cannot retreat” (e.g. Shadow Bind).
- `gameFlags` for things like “opponent skips attack next turn.”

### Gaps / improvements

1. **Passive abilities (e.g. Klefki – Mischievous Lock)**  
   - The card has `trigger: 'passive'` and `effect: (state) => state`.  
   - The engine does **not** yet check “is the opponent’s Active Klefki?” when generating **UseAbility** actions. So we don’t nullify “Basic Pokemon” abilities when Klefki is active.  
   - **Fix:** When generating legal actions, skip **UseAbility** for a Pokemon if that Pokemon is Basic and the opponent’s active has an ability that nullifies Basic abilities (e.g. Mischievous Lock).

2. **Explicit choices**  
   - Real Quick Search: “search your deck for **any 1 card**” → player chooses.  
   - Our sim: the **effect function** chooses (heuristic). So the AI doesn’t see a “choose card from deck” action; it just picks “Use Quick Search” and the heuristic runs.  
   - For a more general design you could add actions like `ChooseCardFromDeck` and let the AI/player pick; then the effect would apply that choice. Right now we trade that for simplicity and speed.

3. **Stadium effects**  
   - Stadium is in state; whether each stadium’s effect is implemented is per-card (e.g. in trainer effect or a dedicated check). Area Zero Underdepths would need a concrete rule (e.g. when does it trigger, what does it do) and a place in the engine or in a stadium-effect hook.

4. **First-turn rule**  
   - “Can’t attack on first turn (or if you went second, your first turn)” is often in the rules. Worth confirming `canAttack` / first-turn logic in `game-engine.ts` matches the intended rule.

5. **Description ↔ effect single source of truth**  
   - Today: description is display-only; effect is code. So the “compiler” doesn’t drive ability execution.  
   - To make “description → DSL → run” the single source of truth for new cards, you’d: (a) compile ability text to EffectDSL at import time, (b) store DSL on the card or in a side map, (c) in the engine, when applying UseAbility, call EffectExecutor with that DSL (and a context that includes the ability’s Pokemon/player) instead of calling a hand-coded function.

---

## 4. Recommended next steps

1. **Document the two paths** in code: add a short comment in `types.ts` (Ability interface) and in `game-engine.ts` (useAbility) stating that “ability behavior is the `effect` function; description is for display; DSL/compiler is used for import/validation only unless we wire it here.”
2. **Implement passive-ability checks** in `getLegalActions`: e.g. before adding UseAbility for a Pokemon, check if the opponent’s active has a passive that nullifies that Pokemon’s ability (e.g. Basic + Mischievous Lock).
3. **Stadium and first-turn rules** in one place: either a small “rules” module or clearly in the engine (e.g. “no attack on the turn when you went second”).
4. **Optional:** Add a runtime path “ability has EffectDSL → run EffectExecutor” so that imported/compiled abilities can work without hand-coding a function for every card.

If you want, next we can (a) add the Klefki/Mischievous Lock check in `getLegalActions`, or (b) sketch the exact changes to wire EffectDSL for abilities into the engine.
