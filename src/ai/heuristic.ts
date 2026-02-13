/**
 * Smart Heuristic AI for the Charizard ex deck.
 *
 * Deck Strategy:
 * 1. Turn 1: Play Fan Rotom, use Fan Call to search Colorless setup Pokemon
 * 2. Get Terapagos ex on bench (Tera enabler for Noctowl)
 * 3. Evolve Hoothoot → Noctowl with Terapagos in play → Jewel Seeker (2 Trainers!)
 * 4. Evolve Charmander → Charmeleon → Charizard ex (or Rare Candy skip)
 *    Charizard ex's Infernal Reign attaches 3 Fire Energy on evolve!
 * 5. Evolve Pidgey → Pidgeotto → Pidgeot ex for Quick Search every turn
 * 6. Charizard ex attacks with Burning Darkness (180 + 30 per opponent prize taken)
 * 7. Dusknoir's Cursed Blast: put 130 damage on ANY opponent Pokemon, KO your active.
 *    Use strategically to snipe key targets or close out games.
 */
import type { GameState, Action, PokemonInPlay, PokemonCard, EnergyCard, Card } from '../engine/types.js';
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

/** Is this the early game (first few turns)? */
function isEarlyGame(state: GameState): boolean {
  return state.turnNumber <= 4;
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
  const earlyGame = isEarlyGame(state);

  // Deck safety: severely penalize deck-thinning actions when deck is small
  const deckSize = player.deck.length;
  const deckDangerPenalty = deckSize < 10 ? -200 : deckSize < 20 ? -50 : 0;

  switch (action.type) {
    case ActionType.PlayPokemon: {
      const card = player.hand[action.payload.handIndex] as PokemonCard;
      if (!card) return -100;

      // ----- EVOLUTIONS -----
      if (card.stage !== PokemonStage.Basic) {
        if (CHARIZARD_LINE.has(card.name)) return 95;
        if (card.name === 'Pidgeot ex') return 93;
        if (card.name === 'Pidgeotto') return 88;
        // Noctowl: higher priority if Terapagos is in play (Jewel Seeker activates!)
        if (card.name === 'Noctowl') {
          return hasTerapagosInPlay(state) ? 92 : 65;
        }
        if (card.name === 'Dusknoir') return 70;
        if (card.name === 'Dusclops') return 60;
        return 55;
      }

      // ----- BASICS TO BENCH -----
      if (player.bench.length >= 5) return -100; // Can't bench more

      // Charmander is highest priority if we don't have Charizard line in play
      if (card.name === 'Charmander') {
        if (!names.has('Charmander') && !names.has('Charmeleon') && !names.has('Charizard ex')) return 86;
        return 60; // Second Charmander is backup
      }
      // Pidgey for the Pidgeot ex engine
      if (card.name === 'Pidgey') {
        if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return 83;
        return 35;
      }
      // Terapagos ex: needed to enable Noctowl's Jewel Seeker
      if (card.name === 'Terapagos ex') {
        if (!names.has('Terapagos ex')) {
          // Higher priority if we have Hoothoot/Noctowl to evolve
          const hasNoctowlLine = names.has('Hoothoot') || player.hand.some(c => c.name === 'Noctowl');
          return hasNoctowlLine ? 84 : 72;
        }
        return 30;
      }
      // Hoothoot: needed for Noctowl which searches 2 Trainers
      if (card.name === 'Hoothoot') {
        if (!names.has('Hoothoot') && !names.has('Noctowl')) return 75;
        return 25;
      }
      // Duskull for late-game Dusknoir snipe
      if (card.name === 'Duskull') {
        if (!names.has('Duskull') && !names.has('Dusclops') && !names.has('Dusknoir')) return 55;
        return 20;
      }
      // Fan Rotom: great turn 1 for Fan Call, less useful later
      if (card.name === 'Fan Rotom') {
        return earlyGame ? 78 : 25;
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

      // Fire energy to Charizard line is top priority
      if (WANTS_FIRE_ENERGY.has(targetName) && energyCard.energyType === EnergyType.Fire) {
        const fireCount = countFireEnergy(target);
        if (targetName === 'Charizard ex') {
          if (fireCount === 0) return 98;
          if (fireCount === 1) return 96; // Can attack with 2 Fire!
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

      // --- Rare Candy: skip to Stage 2 ---
      if (name === 'Rare Candy') {
        const hasCharmanderInPlay = getAllInPlay(state).some(
          p => p.card.name === 'Charmander' && p.turnPlayed !== state.turnNumber
        );
        const hasCharizardInHand = player.hand.some(c => c.name === 'Charizard ex');
        if (hasCharmanderInPlay && hasCharizardInHand) return 97;
        const hasDuskullInPlay = getAllInPlay(state).some(
          p => p.card.name === 'Duskull' && p.turnPlayed !== state.turnNumber
        );
        const hasDusknoirInHand = player.hand.some(c => c.name === 'Dusknoir');
        if (hasDuskullInPlay && hasDusknoirInHand) return 68;
        return -50; // No valid target, don't waste it
      }

      // --- Nest Ball: search Basic Pokemon ---
      if (name === 'Nest Ball') {
        if (player.bench.length >= 5) return -50;
        if (!names.has('Charmander') && !names.has('Charmeleon') && !names.has('Charizard ex')) return 82 + searchPenalty;
        if (!names.has('Pidgey') && !names.has('Pidgeotto') && !names.has('Pidgeot ex')) return 78 + searchPenalty;
        if (!names.has('Terapagos ex')) return 72 + searchPenalty;
        if (!names.has('Hoothoot') && !names.has('Noctowl')) return 68 + searchPenalty;
        if (!names.has('Duskull') && !names.has('Dusclops') && !names.has('Dusknoir')) return 50 + searchPenalty;
        return -20 + searchPenalty;
      }

      // --- Ultra Ball: search any Pokemon (costs 2 cards discard) ---
      if (name === 'Ultra Ball') {
        if (player.hand.length < 3) return -50;
        if (!names.has('Charizard ex') && !names.has('Charmeleon')) return 80 + searchPenalty;
        if (!names.has('Pidgeot ex') && !names.has('Pidgeotto')) return 75 + searchPenalty;
        return -20;
      }

      // --- Buddy-Buddy Poffin: bench 2 basics ≤70 HP ---
      if (name === 'Buddy-Buddy Poffin') {
        if (player.bench.length >= 4) return -20;
        if (player.bench.length >= 5) return -50;
        if (earlyGame) return 76 + searchPenalty;
        return 40 + searchPenalty;
      }

      // --- Boss's Orders: gust for KO ---
      if (name === "Boss's Orders") {
        const opponent = getOpponent(state);
        if (player.active && opponent.bench.length > 0) {
          const activeDamage = getMaxDamage(player.active, state);
          // Look for KO-able bench Pokemon, prioritize by prize value
          const koTarget = opponent.bench
            .filter(p => p.currentHp <= activeDamage)
            .sort((a, b) => (b.card.prizeCards || 1) - (a.card.prizeCards || 1))[0];
          if (koTarget) {
            const prizeValue = koTarget.card.prizeCards || 1;
            return 88 + prizeValue * 2; // Higher for ex KOs
          }
        }
        return -20; // Don't waste Boss if no KO opportunity
      }

      // --- Prime Catcher: gust + switch (costs 1 card discard) ---
      if (name === 'Prime Catcher') {
        if (player.hand.length < 2) return -50;
        const opponent = getOpponent(state);
        if (player.active && opponent.bench.length > 0) {
          const activeDamage = getMaxDamage(player.active, state);
          const canKOBench = opponent.bench.some(p => p.currentHp <= activeDamage);
          if (canKOBench) return 89;
        }
        return -20;
      }

      // --- Iono: hand shuffle ---
      if (name === 'Iono') {
        const opponent = getOpponent(state);
        // Great disruption when opponent has a big hand
        if (opponent.hand.length >= 6) return 72;
        // Good when we have a bad/empty hand
        if (player.hand.length <= 3 && player.prizes.length > 2) return 65;
        // Don't use Iono if we already have a good hand
        if (player.hand.length >= 5) return -30;
        return -10;
      }

      // --- Dawn: search for evolution line ---
      if (name === 'Dawn') {
        if (!names.has('Charizard ex') || !names.has('Pidgeot ex')) return 73 + searchPenalty;
        return -20;
      }

      // --- Super Rod: shuffle Pokemon/Energy back to deck (shuffles INTO deck, safe) ---
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
        // Only good if Terapagos is active and can KO something
        if (player.active?.card.name.includes('Terapagos')) return 45;
        return -20;
      }

      // --- Area Zero Underdepths: stadium ---
      if (name === 'Area Zero Underdepths') {
        if (state.stadium) return 15; // Replace opponent's stadium
        if (names.has('Terapagos ex')) return 20; // Synergy with Tera
        return -20; // Not worth playing without good reason
      }

      return -10; // Unknown trainers: don't play randomly
    }

    case ActionType.UseAbility: {
      const abilityName = action.payload.abilityName as string;

      // Pidgeot ex Quick Search: best ability in the deck, always use
      if (abilityName === 'Quick Search') return 99;

      // Fan Rotom Fan Call: great early game setup
      if (abilityName === 'Fan Call') return 90;

      // Dusknoir Cursed Blast: 130 damage to any opponent Pokemon, self-KO
      if (abilityName === 'Cursed Blast') {
        const opponent = getOpponent(state);
        const allOpponent: PokemonInPlay[] = [];
        if (opponent.active) allOpponent.push(opponent.active);
        allOpponent.push(...opponent.bench);

        // Check if 130 damage KOs any opponent Pokemon
        const koTargets = allOpponent.filter(p => p.currentHp <= 130);
        if (koTargets.length > 0) {
          // Best target: highest prize value KO
          const bestKO = koTargets.reduce((a, b) =>
            (b.card.prizeCards || 1) > (a.card.prizeCards || 1) ? b : a
          );
          const prizeValue = bestKO.card.prizeCards || 1;
          // KOing a 2-prize ex is amazing; KOing a 1-prize basic is okay
          if (prizeValue >= 2) return 93;
          // Only KO 1-prize if we're close to winning
          if (player.prizes.length <= 2) return 85;
          return 70;
        }
        // No KO available — don't sacrifice your active for nothing
        return -100;
      }

      // Fezandipiti ex Flip the Script: draw 3
      if (abilityName === 'Flip the Script') return 65;

      // Noctowl Jewel Seeker (triggered on evolve, shouldn't appear as use)
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
        return 96; // Top priority: get Charizard attacking!
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
      // Scoring for pending energy attachments (from searchAndAttach)
      const targetPokemon = action.payload.zone === 'active'
        ? getPlayer(state).active
        : getPlayer(state).bench[action.payload.benchIndex];
      if (!targetPokemon) return 0;

      let score = 10;
      // Prefer attaching to Fire-type Pokemon (Charizard line wants energy)
      if (targetPokemon.card.type === EnergyType.Fire) score += 30;
      // Prefer Pokemon in the Charizard line
      if (CHARIZARD_LINE.has(targetPokemon.card.name)) score += 40;
      // Prefer active if it can attack
      if (action.payload.zone === 'active') score += 10;
      // Prefer Pokemon with fewer energy attached (spread if needed)
      if (targetPokemon.attachedEnergy.length === 0) score += 20;
      return score;
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

  // Pass in attack phase — only if we can't attack
  return -10;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

// ============================================================================
// CHOOSE CARD HEURISTIC (PendingChoice)
// ============================================================================

function scoreChooseCardAction(state: GameState, action: Action): number {
  if (action.type !== ActionType.ChooseCard) return 0;
  const { choiceId, label } = action.payload;
  const choice = state.pendingChoice;
  if (!choice) return 0;

  // Skip action: usually bad unless we've already picked good cards
  if (choiceId === 'skip') {
    return choice.selectedSoFar.length > 0 ? 10 : -50;
  }

  switch (choice.choiceType) {
    case 'searchCard': {
      // Prioritize by strategic value
      if (CHARIZARD_LINE.has(label)) return 95;
      if (label === 'Pidgeot ex') return 93;
      if (label === 'Pidgeotto') return 88;
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
      // Generic Pokemon
      if (SUPPORT_POKEMON.has(label)) return 75;
      return 50;
    }

    case 'discardCard': {
      // When forced to discard (Ultra Ball), prefer discarding expendable cards
      // Lower score = MORE preferred to discard (we invert: higher score = card we WANT to discard)
      if (label.includes('Energy')) return 70; // Energy is expendable
      if (CHARIZARD_LINE.has(label)) return -80; // Never discard Charizard line
      if (label === 'Rare Candy') return -60;
      if (label === "Boss's Orders") return -40;
      if (label === 'Pidgeot ex') return -50;
      // Duplicates and basics are OK to discard
      if (SUPPORT_POKEMON.has(label)) return 30;
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
      // High-prize targets
      if (target.card.prizeCards >= 2) score += 30;
      // KO-able?
      const attacker = state.players[state.currentPlayer].active;
      if (attacker) {
        const topAttackDmg = Math.max(...attacker.card.attacks.map(a => a.damage));
        if (topAttackDmg >= target.currentHp) score += 40;
      }
      // Strand high-retreat Pokemon
      if (target.card.retreatCost >= 2) score += 20;
      // Important targets
      if (target.card.name === 'Charizard ex' || target.card.name === 'Pidgeot ex') score += 15;
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
