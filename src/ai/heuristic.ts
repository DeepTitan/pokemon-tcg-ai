/**
 * Smart Heuristic AI for the Charizard ex deck.
 *
 * Competitive Charizard ex Strategy (2-2-2 prize pattern):
 * T1: Buddy-Buddy Poffin → Fan Rotom + Charmander, Fan Call → Pidgey + Hoothoot + Noctowl
 * T2: Dawn → Terapagos ex + Noctowl + Charizard ex, evolve Noctowl (Jewel Seeker → Rare Candy),
 *     Rare Candy → Charizard ex (Infernal Reign → 3 Fire), attack with Burning Darkness (180 dmg)
 * T3+: Pidgeot ex Quick Search → Boss's Orders / Prime Catcher, gust bench ex, attack for KO
 *
 * Turn numbering: turnNumber is global. P0's first turn = 1, P1's first = 2, P0's second = 3, etc.
 * Fan Call condition: turnNumber <= 2 (each player's FIRST turn only)
 */
import type { GameState, Action, PokemonInPlay, PokemonCard, EnergyCard, Card, PendingChoice } from '../engine/types.js';
import { ActionType, EnergyType, PokemonStage, CardType, GamePhase } from '../engine/types.js';

// ============================================================================
// CARD KNOWLEDGE
// ============================================================================

/** Cards that are part of the main attacker line */
const CHARIZARD_LINE = new Set(['Charmander', 'Charmeleon', 'Charizard ex']);

/** Utility/support Pokemon that don't need energy */
const SUPPORT_POKEMON = new Set([
  'Fan Rotom', 'Klefki', 'Hoothoot', 'Noctowl',
  'Pidgey', 'Pidgeotto', 'Pidgeot ex',
  'Duskull', 'Dusclops', 'Dusknoir',
  'Terapagos ex', 'Fezandipiti ex',
]);

/** Cards that want Fire Energy */
const WANTS_FIRE_ENERGY = new Set(['Charmander', 'Charmeleon', 'Charizard ex']);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPlayer(state: GameState) {
  return state.players[state.currentPlayer];
}

function getOpponent(state: GameState) {
  return state.players[state.currentPlayer === 0 ? 1 : 0];
}

function getAllInPlay(state: GameState): PokemonInPlay[] {
  const player = getPlayer(state);
  const result: PokemonInPlay[] = [];
  if (player.active) result.push(player.active);
  result.push(...player.bench);
  return result;
}

function countFireEnergy(pokemon: PokemonInPlay): number {
  return pokemon.attachedEnergy.filter(e => e.energyType === EnergyType.Fire).length;
}

function countTotalEnergy(pokemon: PokemonInPlay): number {
  return pokemon.attachedEnergy.length;
}

function canAttackWith(pokemon: PokemonInPlay): boolean {
  for (const attack of pokemon.card.attacks) {
    const fireCost = attack.cost.filter(e => e === EnergyType.Fire).length;
    const colorlessCost = attack.cost.filter(e => e === EnergyType.Colorless).length;
    const fireAttached = countFireEnergy(pokemon);
    const totalAttached = countTotalEnergy(pokemon);
    if (fireAttached >= fireCost && totalAttached >= fireCost + colorlessCost) {
      return true;
    }
  }
  return false;
}

function getMaxDamage(pokemon: PokemonInPlay, state?: GameState): number {
  let maxDmg = 0;
  for (const attack of pokemon.card.attacks) {
    let dmg = attack.damage;
    // Burning Darkness bonus
    if (attack.name === 'Burning Darkness' && state) {
      const opponent = getOpponent(state);
      const prizesTaken = 6 - opponent.prizes.length;
      dmg += prizesTaken * 30;
    }
    if (dmg > maxDmg) maxDmg = dmg;
  }
  return maxDmg;
}

function inPlayNames(state: GameState): Set<string> {
  return new Set(getAllInPlay(state).map(p => p.card.name));
}

function hasTerapagosInPlay(state: GameState): boolean {
  return getAllInPlay(state).some(p => p.card.name.includes('Terapagos'));
}

// ============================================================================
// TURN-PHASE HELPERS
// ============================================================================

/** Turn 1: each player's first turn (global turnNumber 1-2) */
function isT1(state: GameState): boolean {
  return state.turnNumber <= 2;
}

/** Turn 2: each player's second turn (global turnNumber 3-4) */
function isT2(state: GameState): boolean {
  return state.turnNumber >= 3 && state.turnNumber <= 4;
}

/** Turn 3+: aggressive phase (global turnNumber 5+) */
function isT3Plus(state: GameState): boolean {
  return state.turnNumber >= 5;
}

/** Check if we have any Charizard line member in play */
function hasCharizardLine(state: GameState): boolean {
  const n = inPlayNames(state);
  return n.has('Charmander') || n.has('Charmeleon') || n.has('Charizard ex');
}

/** Detect which phase of Dawn's 3-part search we're in */
function getDawnSearchPhase(choice: PendingChoice): 'basic' | 'stage1' | 'stage2ex' {
  const firstOption = choice.options[0];
  if (!firstOption || !firstOption.card) return 'basic';
  const card = firstOption.card as PokemonCard;
  if (card.cardType !== CardType.Pokemon) return 'basic';
  if (card.stage === PokemonStage.Basic) return 'basic';
  if (card.stage === PokemonStage.Stage1) return 'stage1';
  return 'stage2ex'; // Stage2 or ex
}

// ============================================================================
// MAIN PHASE HEURISTIC
// ============================================================================

/** Trainers that search the deck (thin it out) */
const DECK_SEARCH_TRAINERS = new Set([
  'Buddy-Buddy Poffin', 'Nest Ball', 'Ultra Ball', 'Dawn', 'Night Stretcher', 'Super Rod',
]);

function scoreMainAction(state: GameState, action: Action): number {
  const player = getPlayer(state);
  const names = inPlayNames(state);

  // Deck safety: severely penalize deck-thinning actions when deck is small
  const deckSize = player.deck.length;
  const deckDangerPenalty = deckSize < 10 ? -200 : deckSize < 20 ? -50 : 0;

  switch (action.type) {
    case ActionType.PlayPokemon: {
      const card = player.hand[action.payload.handIndex] as PokemonCard;
      if (!card) return -100;

      // ----- EVOLUTIONS -----
      if (card.stage !== PokemonStage.Basic) {
        // Charizard ex: highest evolution priority always
        if (card.name === 'Charizard ex') return isT2(state) ? 99 : 97;
        // Noctowl: critical on T2 with Terapagos (Jewel Seeker → 2 Trainers)
        if (card.name === 'Noctowl') {
          if (hasTerapagosInPlay(state)) return isT2(state) ? 97 : 80;
          return isT2(state) ? 65 : 55;
        }
        // Pidgeot ex: Quick Search engine, more valuable T3+
        if (card.name === 'Pidgeot ex') return isT3Plus(state) ? 95 : 88;
        if (card.name === 'Pidgeotto') return isT3Plus(state) ? 88 : 82;
        // Charmeleon: only if no Rare Candy path
        if (card.name === 'Charmeleon') return isT2(state) ? 75 : 70;
        // Dusknoir: late-game snipe piece
        if (card.name === 'Dusknoir') return isT3Plus(state) ? 80 : 55;
        if (card.name === 'Dusclops') return isT3Plus(state) ? 60 : 45;
        return 55;
      }

      // ----- BASICS TO BENCH -----
      if (player.bench.length >= 5) return -100; // Can't bench more

      // Fan Rotom: THE key T1 play for Fan Call
      if (card.name === 'Fan Rotom') {
        if (isT1(state)) return 98;
        if (isT2(state)) return 25;
        return 15;
      }
      // Charmander is highest priority if we don't have Charizard line in play
      if (card.name === 'Charmander') {
        if (!names.has('Charmander') && !names.has('Charmeleon') && !names.has('Charizard ex')) {
          if (isT1(state)) return 95;
          if (isT2(state)) return 90;
          return 85;
        }
        return isT1(state) ? 55 : 40; // Second Charmander is backup
      }
      // Hoothoot: needed for Noctowl → Jewel Seeker on T2
      if (card.name === 'Hoothoot') {
        if (!names.has('Hoothoot') && !names.has('Noctowl')) {
          if (isT1(state)) return 92;
          if (isT2(state)) return 80;
          return 45;
        }
        return 25;
      }
      // Pidgey for the Pidgeot ex engine
      if (card.name === 'Pidgey') {
        if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) {
          if (isT1(state)) return 90;
          if (isT2(state)) return 85;
          return 75;
        }
        return 35;
      }
      // Terapagos ex: needed to enable Noctowl's Jewel Seeker
      if (card.name === 'Terapagos ex') {
        if (!names.has('Terapagos ex')) {
          if (isT1(state)) return 88;
          if (isT2(state)) return 90; // Slightly higher T2 — needed before Noctowl evolves
          return 50;
        }
        return 30;
      }
      // Duskull for late-game Dusknoir snipe
      if (card.name === 'Duskull') {
        if (!names.has('Duskull') && !names.has('Dusclops') && !names.has('Dusknoir')) {
          if (isT1(state)) return 40;
          if (isT2(state)) return 50;
          return 65;
        }
        return 20;
      }
      // Fezandipiti ex: Flip the Script draw
      if (card.name === 'Fezandipiti ex') return 40;
      // Klefki: ability lock
      if (card.name === 'Klefki') return 35;
      return 25;
    }

    case ActionType.AttachEnergy: {
      const energyCard = player.hand[action.payload.handIndex] as EnergyCard;
      const isToActive = action.payload.target === 'active';
      const target = isToActive
        ? player.active
        : player.bench[action.payload.benchIndex];
      if (!target || !energyCard) return -100;

      const targetName = target.card.name;

      // Jet Energy: special Colorless — don't waste on Charizard (only needs Fire)
      if (energyCard.name === 'Jet Energy') {
        // Active support needing retreat with Charizard ready on bench
        if (isToActive && SUPPORT_POKEMON.has(targetName)) {
          const retreatCost = target.card.retreatCost || 0;
          const currentEnergy = countTotalEnergy(target);
          if (currentEnergy < retreatCost) {
            const hasReadyAttacker = player.bench.some(
              b => b.card.name === 'Charizard ex' && canAttackWith(b)
            );
            if (hasReadyAttacker) return 94; // Retreat to Charizard!
          }
        }
        // Jet Energy on Charizard ex is wasted (only 2 Fire needed, no Colorless in cost)
        if (targetName === 'Charizard ex') return -5;
        // Attach to support for retreat potential
        if (isToActive && SUPPORT_POKEMON.has(targetName)) return 15;
        return 10;
      }

      // Fire energy to Charizard line is top priority
      if (WANTS_FIRE_ENERGY.has(targetName) && energyCard.energyType === EnergyType.Fire) {
        const fireCount = countFireEnergy(target);
        if (targetName === 'Charizard ex') {
          if (fireCount === 0) return 98;
          if (fireCount === 1) return 97; // Can attack with 2 Fire!
          return 35; // Already powered up
        }
        if (targetName === 'Charmeleon') {
          if (fireCount === 0) return 88;
          return 45;
        }
        if (targetName === 'Charmander') {
          if (fireCount === 0) return 78;
          return 40;
        }
      }

      // Attach energy to active support Pokemon to enable retreat to a ready attacker
      if (isToActive && SUPPORT_POKEMON.has(targetName)) {
        const retreatCost = target.card.retreatCost || 0;
        const currentEnergy = countTotalEnergy(target);
        if (currentEnergy < retreatCost) {
          // Check if we have a Charizard line member on bench that can attack
          const hasReadyAttacker = player.bench.some(
            b => CHARIZARD_LINE.has(b.card.name) && canAttackWith(b)
          );
          if (hasReadyAttacker) return 92; // Need this energy to retreat for Charizard!
          // Check if we have any non-support Pokemon on bench
          const hasNonSupport = player.bench.some(b => !SUPPORT_POKEMON.has(b.card.name));
          if (hasNonSupport) return 50; // Retreat for some attacker
        }
        return -10; // Already have enough to retreat, or no good retreat target
      }

      // Don't waste fire energy on support Pokemon from bench
      if (SUPPORT_POKEMON.has(targetName)) return -10;

      return 10;
    }

    case ActionType.PlayTrainer: {
      const card = player.hand[action.payload.handIndex];
      if (!card) return -100;
      const name = card.name;

      // Apply deck-thinning penalty for search trainers
      const searchPenalty = DECK_SEARCH_TRAINERS.has(name) ? deckDangerPenalty : 0;

      // --- Buddy-Buddy Poffin: bench 2 basics ≤70 HP ---
      if (name === 'Buddy-Buddy Poffin') {
        if (player.bench.length >= 4) return -20;
        if (player.bench.length >= 5) return -50;
        if (isT1(state)) return 100 + searchPenalty; // HIGHEST T1 priority
        if (isT2(state)) return 65 + searchPenalty;
        return 40 + searchPenalty;
      }

      // --- Rare Candy: skip to Stage 2 ---
      if (name === 'Rare Candy') {
        const hasCharmanderInPlay = getAllInPlay(state).some(
          p => p.card.name === 'Charmander' && p.turnPlayed !== state.turnNumber
        );
        const hasCharizardInHand = player.hand.some(c => c.name === 'Charizard ex');
        if (hasCharmanderInPlay && hasCharizardInHand) {
          return isT2(state) ? 99 : 97; // T2 Rare Candy is critical for the gameplan
        }
        const hasDuskullInPlay = getAllInPlay(state).some(
          p => p.card.name === 'Duskull' && p.turnPlayed !== state.turnNumber
        );
        const hasDusknoirInHand = player.hand.some(c => c.name === 'Dusknoir');
        if (hasDuskullInPlay && hasDusknoirInHand) return 68;
        return -50; // No valid target, don't waste it
      }

      // --- Dawn: search for Basic + Stage1 + Stage2/ex ---
      if (name === 'Dawn') {
        if (isT1(state)) return 60 + searchPenalty; // Playable T1 but Poffin+Fan Call is better
        if (isT2(state)) {
          // T2 Dawn is critical: search Terapagos + Noctowl + Charizard ex
          if (!names.has('Charizard ex')) return 98 + searchPenalty;
          if (!names.has('Pidgeot ex')) return 85 + searchPenalty;
          return 70 + searchPenalty;
        }
        // T3+: only if missing key pieces
        if (!names.has('Charizard ex') || !names.has('Pidgeot ex')) return 75 + searchPenalty;
        return -20;
      }

      // --- Nest Ball: search Basic Pokemon ---
      if (name === 'Nest Ball') {
        if (player.bench.length >= 5) return -50;
        const baseScore = isT1(state) ? 88 : isT2(state) ? 78 : 65;
        if (!names.has('Charmander') && !names.has('Charmeleon') && !names.has('Charizard ex')) return baseScore + searchPenalty;
        if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return (baseScore - 4) + searchPenalty;
        if (!names.has('Terapagos ex')) return (baseScore - 8) + searchPenalty;
        if (!names.has('Hoothoot') && !names.has('Noctowl')) return (baseScore - 12) + searchPenalty;
        if (!names.has('Duskull') && !names.has('Dusclops') && !names.has('Dusknoir')) return (baseScore - 20) + searchPenalty;
        return -20 + searchPenalty;
      }

      // --- Ultra Ball: search any Pokemon (costs 2 cards discard) ---
      if (name === 'Ultra Ball') {
        if (player.hand.length < 3) return -50;
        if (!names.has('Charizard ex') && !names.has('Charmeleon')) return 80 + searchPenalty;
        if (!names.has('Pidgeot ex') && !names.has('Pidgeotto')) return 75 + searchPenalty;
        return -20;
      }

      // --- Boss's Orders: gust for KO ---
      if (name === "Boss's Orders") {
        // Never waste supporter slot during setup turns
        if (isT1(state) || isT2(state)) return -30;

        const opponent = getOpponent(state);
        if (player.active && opponent.bench.length > 0) {
          const activeDamage = getMaxDamage(player.active, state);
          // Look for KO-able bench Pokemon, prioritize by prize value
          const koTargets = opponent.bench
            .filter(p => p.currentHp <= activeDamage)
            .sort((a, b) => (b.card.prizeCards || 1) - (a.card.prizeCards || 1));
          if (koTargets.length > 0) {
            const prizeValue = koTargets[0].card.prizeCards || 1;
            return 90 + prizeValue * 5; // 95 for 1-prize, 100 for 2-prize ex KO
          }
          // Even without KO, consider stranding a high-retreat ex
          const strandTargets = opponent.bench.filter(
            p => p.card.retreatCost >= 2 && (p.card.prizeCards || 1) >= 2
          );
          if (strandTargets.length > 0) return 40; // Strand a big ex
        }
        return -20; // Don't waste Boss if no opportunity
      }

      // --- Prime Catcher: gust + switch (costs 1 card discard) ---
      if (name === 'Prime Catcher') {
        // Don't use during setup
        if (isT1(state) || isT2(state)) return -20;
        if (player.hand.length < 2) return -50;
        const opponent = getOpponent(state);
        if (player.active && opponent.bench.length > 0) {
          const activeDamage = getMaxDamage(player.active, state);
          const koTargets = opponent.bench.filter(p => p.currentHp <= activeDamage);
          if (koTargets.length > 0) {
            const bestPrize = Math.max(...koTargets.map(p => p.card.prizeCards || 1));
            return 88 + bestPrize * 3; // 91 for 1-prize, 94 for 2-prize
          }
        }
        return -20;
      }

      // --- Iono: hand shuffle ---
      if (name === 'Iono') {
        // Never use during setup — we need our hand
        if (isT1(state)) return -40;
        if (isT2(state)) return -30;
        const opponent = getOpponent(state);
        // Great disruption when opponent has a big hand
        if (opponent.hand.length >= 6) return 72;
        // Good when we have a bad/empty hand
        if (player.hand.length <= 3 && player.prizes.length > 2) return 65;
        // Don't use Iono if we already have a good hand
        if (player.hand.length >= 5) return -30;
        return -10;
      }

      // --- Super Rod: shuffle Pokemon/Energy back to deck ---
      if (name === 'Super Rod') {
        const hasKeyDiscard = player.discard.some(c =>
          c.name === 'Charizard ex' || c.name === 'Pidgeot ex' || c.name === 'Rare Candy'
        );
        if (hasKeyDiscard) return 62;
        const hasFireEnergyDiscard = player.discard.filter(c =>
          c.cardType === CardType.Energy && (c as EnergyCard).energyType === EnergyType.Fire
        ).length;
        if (hasFireEnergyDiscard >= 3) return 50;
        return -30;
      }

      // --- Night Stretcher: recover 1 Pokemon or Energy to hand ---
      if (name === 'Night Stretcher') {
        const hasKeyDiscard = player.discard.some(c =>
          c.name === 'Charizard ex' || c.name === 'Pidgeot ex'
        );
        if (hasKeyDiscard) return 64;
        const hasFireDiscard = player.discard.some(c =>
          c.cardType === CardType.Energy && (c as EnergyCard).energyType === EnergyType.Fire
        );
        if (hasFireDiscard && !names.has('Charizard ex')) return 35;
        return -30;
      }

      // --- Briar: +1 prize on Tera KO ---
      if (name === 'Briar') {
        if (isT1(state) || isT2(state)) return -30;
        if (player.active?.card.name.includes('Terapagos')) return 45;
        return -20;
      }

      // --- Area Zero Underdepths: stadium ---
      if (name === 'Area Zero Underdepths') {
        if (state.stadium) return 15; // Replace opponent's stadium
        if (names.has('Terapagos ex')) return 20; // Synergy with Tera
        return -20;
      }

      return -10; // Unknown trainers: don't play randomly
    }

    case ActionType.UseAbility: {
      const abilityName = action.payload.abilityName as string;

      // Pidgeot ex Quick Search: best ability in the deck, always use
      if (abilityName === 'Quick Search') return 99;

      // Fan Rotom Fan Call: MUST use on T1 (condition blocks it after turnNumber > 2)
      if (abilityName === 'Fan Call') return 99;

      // Dusknoir Cursed Blast: 130 damage to any opponent Pokemon, self-KO
      if (abilityName === 'Cursed Blast') {
        // Never use during setup
        if (isT1(state) || isT2(state)) return -100;

        const opponent = getOpponent(state);
        const abilityTarget = action.payload.abilityTarget;
        if (!abilityTarget) return -100;

        // Resolve which Pokemon is being targeted
        const targetPokemon = abilityTarget.zone === 'active'
          ? opponent.active
          : opponent.bench[abilityTarget.benchIndex ?? 0];
        if (!targetPokemon) return -100;

        const targetHp = targetPokemon.currentHp;
        const targetPrizeValue = targetPokemon.card.prizeCards || 1;

        // Case 1: Direct KO
        if (targetHp <= 130) {
          if (targetPrizeValue >= 2) return 96; // KO a 2-prize ex
          if (player.prizes.length <= 2) return 88; // Close to winning, any KO helps
          return 72; // KO a 1-prize basic
        }

        // Case 2: Soften for Charizard KO next turn
        const hasCharizardOnBench = player.bench.some(
          p => p.card.name === 'Charizard ex' && countFireEnergy(p) >= 2
        );
        if (hasCharizardOnBench) {
          const prizesTaken = 6 - opponent.prizes.length;
          const burningDarknessDmg = 180 + prizesTaken * 30;
          const hpAfterCursed = targetHp - 130;
          if (hpAfterCursed > 0 && hpAfterCursed <= burningDarknessDmg) {
            if (targetPrizeValue >= 2) return 85; // Set up 2-prize KO
            return 60;
          }
        }

        // Case 3: No strategic value — don't sacrifice for nothing
        return -100;
      }

      // Fezandipiti ex Flip the Script: draw 3
      if (abilityName === 'Flip the Script') return 65;

      // Klefki Mischievous Lock (passive)
      if (abilityName === 'Mischievous Lock') return 55;

      return 45;
    }

    case ActionType.Retreat: {
      if (!player.active) return -100;
      const activeName = player.active.card.name;
      const benchTarget = player.bench[action.payload.benchIndex];
      if (!benchTarget) return -100;
      const benchTargetName = benchTarget.card.name;

      // Retreat support Pokemon for a powered-up Charizard ex
      if (SUPPORT_POKEMON.has(activeName) && benchTargetName === 'Charizard ex' && canAttackWith(benchTarget)) {
        return 98; // Top priority: get Charizard attacking!
      }

      // Retreat for any Charizard line member that can attack
      if (SUPPORT_POKEMON.has(activeName) && CHARIZARD_LINE.has(benchTargetName) && canAttackWith(benchTarget)) {
        return 90;
      }

      // Retreat heavily damaged active to save it (if it's important)
      if (player.active.currentHp <= player.active.card.hp * 0.2 && !SUPPORT_POKEMON.has(benchTargetName)) {
        return 70;
      }

      // Retreat support for other non-support Pokemon
      if (SUPPORT_POKEMON.has(activeName) && !SUPPORT_POKEMON.has(benchTargetName)) {
        return 55;
      }

      // Don't retreat Charizard ex for a support Pokemon
      if (activeName === 'Charizard ex' && SUPPORT_POKEMON.has(benchTargetName)) return -80;

      // Don't retreat an attacker that can still fight
      if (canAttackWith(player.active) && CHARIZARD_LINE.has(activeName)) return -50;

      return 5;
    }

    case ActionType.SelectTarget: {
      // Scoring for pending energy attachments (from Infernal Reign searchAndAttach)
      const targetPokemon = action.payload.zone === 'active'
        ? getPlayer(state).active
        : getPlayer(state).bench[action.payload.benchIndex];
      if (!targetPokemon) return 0;

      // Always attach fire to Charizard ex first
      if (targetPokemon.card.name === 'Charizard ex') {
        const fireCount = countFireEnergy(targetPokemon);
        if (fireCount < 2) return 100; // Charizard needs 2 fire to attack
        return 60; // Extra fire is insurance
      }
      // Backup: attach to other Charizard line members
      if (CHARIZARD_LINE.has(targetPokemon.card.name)) return 50;
      // Don't waste fire energy on support Pokemon
      if (SUPPORT_POKEMON.has(targetPokemon.card.name)) return 5;
      return 10;
    }

    case ActionType.Pass:
      return 0;

    default:
      return 0;
  }
}

// ============================================================================
// ATTACK PHASE HEURISTIC
// ============================================================================

function scoreAttackAction(state: GameState, action: Action): number {
  const player = getPlayer(state);
  const opponent = getOpponent(state);

  if (action.type === ActionType.Attack) {
    if (!player.active) return -100;
    const attack = player.active.card.attacks[action.payload.attackIndex];
    if (!attack) return -100;

    let damage = attack.damage;

    // Burning Darkness bonus
    if (attack.name === 'Burning Darkness') {
      const prizesTaken = 6 - opponent.prizes.length;
      damage += prizesTaken * 30;
    }

    // Huge bonus if this KOs the defender
    if (opponent.active && damage >= opponent.active.currentHp) {
      const prizeValue = opponent.active.card.prizeCards || 1;
      return 100 + prizeValue * 50;
    }

    return 50 + damage;
  }

  // Pass in attack phase — NEVER pass if an attack is available
  return -1000;
}

// ============================================================================
// CHOOSE CARD HEURISTIC (PendingChoice) — Source-Aware
// ============================================================================

function scoreChooseCardAction(state: GameState, action: Action): number {
  if (action.type !== ActionType.ChooseCard) return 0;
  const { choiceId, label } = action.payload;
  const choice = state.pendingChoice;
  if (!choice) return 0;

  const source = choice.sourceCardName;
  const names = inPlayNames(state);
  const player = getPlayer(state);

  // Skip action
  if (choiceId === 'skip') {
    if (choice.selectedSoFar.length > 0) return 5; // Already picked good stuff
    // Never skip first pick for important sources
    if (source === 'Dawn' || source === 'Buddy-Buddy Poffin') return -100;
    return -50;
  }

  switch (choice.choiceType) {
    case 'searchCard': {
      // === BUDDY-BUDDY POFFIN: 2 basics ≤70HP to bench ===
      if (source === 'Buddy-Buddy Poffin') {
        if (label === 'Fan Rotom') {
          if (isT1(state) && !names.has('Fan Rotom')) return 100;
          return 40;
        }
        if (label === 'Charmander') {
          if (!names.has('Charmander') && !names.has('Charmeleon') && !names.has('Charizard ex')) return 95;
          return 50;
        }
        if (label === 'Hoothoot') {
          if (!names.has('Hoothoot') && !names.has('Noctowl')) return 85;
          return 35;
        }
        if (label === 'Pidgey') {
          if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return 80;
          return 30;
        }
        if (label === 'Duskull') return 45;
        if (label === 'Klefki') return 25;
        return 30;
      }

      // === FAN CALL: up to 3 Colorless ≤100HP to hand ===
      if (source === 'Fan Rotom' || source === 'Fan Call') {
        if (label === 'Pidgey') {
          if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return 95;
          return 30;
        }
        if (label === 'Hoothoot') {
          if (!names.has('Hoothoot') && !names.has('Noctowl')) return 93;
          return 60; // Extra Hoothoot for more Noctowl evolves
        }
        if (label === 'Noctowl') return 85; // Great to get directly to hand for T2 evolve
        if (label === 'Pidgeotto') return 75;
        return 40;
      }

      // === DAWN: 3-part search (Basic, Stage1, Stage2/ex) ===
      if (source === 'Dawn') {
        const phase = getDawnSearchPhase(choice);

        if (phase === 'basic') {
          if (label === 'Terapagos ex' || label.includes('Terapagos')) {
            if (!names.has('Terapagos ex')) return 100; // Critical for Jewel Seeker
            return 30;
          }
          if (label === 'Charmander') {
            if (!hasCharizardLine(state)) return 90;
            return 45;
          }
          if (label === 'Pidgey') {
            if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return 80;
            return 25;
          }
          if (label === 'Duskull') return 50;
          if (label === 'Fan Rotom') return 20; // Fan Call only works T1, Dawn is T2+
          if (label === 'Hoothoot') return 70;
          if (label === 'Fezandipiti ex') return 35;
          return 35;
        }

        if (phase === 'stage1') {
          if (label === 'Noctowl') {
            if (hasTerapagosInPlay(state)) return 100; // Jewel Seeker activates!
            return 70;
          }
          if (label === 'Pidgeotto') return 75;
          if (label === 'Charmeleon') return 50; // Only if no Rare Candy
          if (label === 'Dusclops') return 40;
          return 35;
        }

        // stage2ex
        if (label === 'Charizard ex') {
          if (!names.has('Charizard ex')) return 100;
          return 50;
        }
        if (label === 'Pidgeot ex') {
          if (!names.has('Pidgeot ex')) return 90;
          return 30;
        }
        if (label === 'Dusknoir') return 60;
        return 40;
      }

      // === JEWEL SEEKER (Noctowl onEvolve): up to 2 Trainers ===
      if (source === 'Noctowl') {
        if (label === 'Rare Candy') {
          const hasCharmander = getAllInPlay(state).some(
            p => p.card.name === 'Charmander' && p.turnPlayed !== state.turnNumber
          );
          if (hasCharmander) return 100; // Rare Candy to evolve Charmander → Charizard ex
          return 75;
        }
        if (label === "Boss's Orders") {
          if (isT3Plus(state)) return 88;
          return 65;
        }
        if (label === 'Prime Catcher') return 85;
        if (label === 'Nest Ball') return 70;
        if (label === 'Ultra Ball') return 68;
        if (label === 'Buddy-Buddy Poffin') return 60;
        if (label === 'Night Stretcher') return 55;
        if (label === 'Super Rod') return 50;
        if (label === 'Iono') return 45;
        if (label === 'Dawn') return 40;
        if (label === 'Briar') return 35;
        return 35;
      }

      // === QUICK SEARCH (Pidgeot ex): any 1 card ===
      if (source === 'Pidgeot ex' || source === 'Quick Search') {
        const opponent = getOpponent(state);
        const activeDamage = player.active ? getMaxDamage(player.active, state) : 0;

        // If we can KO a bench ex with Boss's Orders
        if (opponent.bench.some(p => p.currentHp <= activeDamage && (p.card.prizeCards || 1) >= 2)) {
          if (label === "Boss's Orders") return 100;
          if (label === 'Prime Catcher') return 98;
        }

        // If Charizard ex is not set up, prioritize Rare Candy / Charizard
        if (!names.has('Charizard ex')) {
          if (label === 'Rare Candy') return 95;
          if (label === 'Charizard ex') return 93;
        }

        // Default T3+ priorities
        if (label === "Boss's Orders") return 88;
        if (label === 'Prime Catcher') return 86;
        if (label === 'Rare Candy') return 80;
        if (CHARIZARD_LINE.has(label)) return 78;
        if (label === 'Iono') return 65;
        if (label.includes('Fire') && label.includes('Energy')) return 60;
        return 50;
      }

      // === NEST BALL: 1 Basic to bench ===
      if (source === 'Nest Ball') {
        if (label === 'Fan Rotom' && isT1(state) && !names.has('Fan Rotom')) return 95;
        if (label === 'Charmander' && !hasCharizardLine(state)) return 92;
        if (label === 'Pidgey' && !names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return 88;
        if ((label === 'Terapagos ex' || label.includes('Terapagos')) && !names.has('Terapagos ex')) return 85;
        if (label === 'Hoothoot' && !names.has('Hoothoot') && !names.has('Noctowl')) return 80;
        if (label === 'Duskull') return 55;
        return 40;
      }

      // === ULTRA BALL: 1 Pokemon from deck ===
      if (source === 'Ultra Ball') {
        if (label === 'Charizard ex' && !names.has('Charizard ex')) return 100;
        if (label === 'Pidgeot ex' && !names.has('Pidgeot ex')) return 92;
        if ((label === 'Terapagos ex' || label.includes('Terapagos')) && !names.has('Terapagos ex')) return 85;
        if (label === 'Noctowl') return 80;
        return 50;
      }

      // === NIGHT STRETCHER / SUPER ROD: recover from discard ===
      if (source === 'Night Stretcher' || source === 'Super Rod') {
        if (label === 'Charizard ex') return 100;
        if (label === 'Pidgeot ex') return 90;
        if (label === 'Fire Energy') return 70;
        if (label === 'Rare Candy') return 65;
        return 40;
      }

      // === FALLBACK: generic search scoring ===
      if (CHARIZARD_LINE.has(label)) return 95;
      if (label === 'Pidgeot ex') return 93;
      if (label === 'Rare Candy') return 90;
      if (label === "Boss's Orders") return 85;
      if (label === 'Terapagos ex') return 84;
      if (label === 'Pidgey') return 82;
      if (label === 'Noctowl') {
        return hasTerapagosInPlay(state) ? 82 : 60;
      }
      if (label === 'Hoothoot') return 75;
      if (label === 'Dusknoir') return 68;
      if (label === 'Dusclops') return 55;
      if (label === 'Duskull') return 50;
      if (label === 'Fan Rotom') return 45;
      if (label === 'Klefki') return 40;
      if (label.includes('Energy')) return 40;
      if (SUPPORT_POKEMON.has(label)) return 75;
      return 50;
    }

    case 'discardCard': {
      // When forced to discard (Ultra Ball), higher score = MORE preferred to discard
      if (CHARIZARD_LINE.has(label)) return -100; // NEVER discard Charizard line
      if (label === 'Rare Candy') return -80;
      if (label === 'Pidgeot ex') return -70;
      if (label === "Boss's Orders") return -50;
      if (label === 'Dawn') {
        // Dawn is expendable T3+ if Charizard is already set up
        if (isT3Plus(state) && names.has('Charizard ex')) return 30;
        return -30;
      }
      // Energy: Jet is least important, Fire more valuable
      if (label === 'Jet Energy') return 80;
      if (label.includes('Energy')) return 60;
      // Fan Rotom is expendable after T1
      if (label === 'Fan Rotom') return isT1(state) ? -40 : 75;
      // Extra copies of support basics
      if (label === 'Hoothoot' && names.has('Hoothoot')) return 70;
      if (label === 'Buddy-Buddy Poffin' && !isT1(state)) return 65;
      if (SUPPORT_POKEMON.has(label)) return 40;
      return 20;
    }

    case 'switchTarget': {
      // When gusting opponent's bench: prioritize KO-able high-prize targets
      const selectedOption = choice.options.find(o => o.id === choiceId);
      if (!selectedOption || selectedOption.benchIndex === undefined) return 50;

      const switchPlayer = choice.switchPlayerIndex ?? choice.playerIndex;
      const targetBench = state.players[switchPlayer].bench;
      const target = targetBench[selectedOption.benchIndex];
      if (!target) return 50;

      let score = 50;
      const prizeValue = target.card.prizeCards || 1;

      // High-prize targets (ex Pokemon)
      if (prizeValue >= 2) score += 40;

      // KO-able?
      const attacker = state.players[state.currentPlayer].active;
      if (attacker) {
        const maxDmg = getMaxDamage(attacker, state);
        if (maxDmg >= target.currentHp) {
          score += 50; // Can KO!
          score += prizeValue * 20; // More prizes = better
        }
      }

      // Strand high-retreat Pokemon
      if (target.card.retreatCost >= 2) score += 15;

      // Target priority by name
      if (target.card.name === 'Charizard ex') score += 20;
      if (target.card.name === 'Pidgeot ex') score += 15;
      if (target.card.name === 'Terapagos ex') score += 10;

      return score;
    }

    case 'evolveTarget': {
      // For Rare Candy: prioritize key evolutions
      if (label.includes('Charizard ex')) return 97;
      if (label.includes('Pidgeot ex')) return 93;
      if (label.includes('Dusknoir')) return 68;
      return 50;
    }
  }

  return 0;
}

export function heuristicSelectAction(state: GameState, actions: Action[]): Action {
  if (actions.length === 1) return actions[0];

  // Use ChooseCard scoring when pendingChoice is active
  let scoreFn: (state: GameState, action: Action) => number;
  if (state.pendingChoice) {
    scoreFn = scoreChooseCardAction;
  } else {
    const isAttackPhase = state.phase === GamePhase.AttackPhase;
    scoreFn = isAttackPhase ? scoreAttackAction : scoreMainAction;
  }

  let bestAction = actions[0];
  let bestScore = -Infinity;

  for (const action of actions) {
    const score = scoreFn(state, action);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  return bestAction;
}
