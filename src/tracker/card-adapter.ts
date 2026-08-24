import {
  CardType,
  EnergySubtype,
  EnergyType,
  PokemonStage,
  TrainerType,
  type Ability,
  type Attack,
  type Card,
  type EnergyCard,
  type PokemonCard,
  type TrainerCard,
} from '../engine/types.js';
import type { CardInfo } from './types.js';

export interface ReviewCardMetadata {
  reviewSourceId?: string;
  reviewRulesText?: string;
}

const ENERGY_CODES: Record<string, EnergyType> = {
  R: EnergyType.Fire,
  F: EnergyType.Fighting,
  W: EnergyType.Water,
  G: EnergyType.Grass,
  L: EnergyType.Lightning,
  P: EnergyType.Psychic,
  D: EnergyType.Dark,
  M: EnergyType.Metal,
  N: EnergyType.Dragon,
  Y: EnergyType.Fairy,
  C: EnergyType.Colorless,
};

function energyType(value: string | undefined): EnergyType {
  if (!value) return EnergyType.Colorless;
  const bracedCode = [...value.matchAll(/\{([^}]+)\}/g)]
    .flatMap((match) => [...match[1].toUpperCase()])
    .map((candidate) => ENERGY_CODES[candidate])
    .find(Boolean);
  return ENERGY_CODES[value.trim().toUpperCase()]
    || bracedCode
    || Object.values(EnergyType).find((type) => value.toLowerCase().includes(type.toLowerCase()))
    || EnergyType.Colorless;
}

function energyCost(value: string): EnergyType[] {
  return [...value.replace(/[^A-Za-z]/g, '')].map((code) => energyType(code));
}

function printedDamage(value: string): number {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function pokemonStage(info: CardInfo): PokemonStage {
  if (info.format?.startsWith('2')) return PokemonStage.Stage2;
  if (info.format?.startsWith('1')) return PokemonStage.Stage1;
  if (/VMAX\b/i.test(info.name)) return PokemonStage.VMAX;
  if (/VSTAR\b/i.test(info.name)) return PokemonStage.VSTAR;
  if (/\bV\b/i.test(info.name)) return PokemonStage.V;
  return PokemonStage.Basic;
}

function trainerType(info: CardInfo): TrainerType {
  const format = info.format?.toUpperCase().replace(/^[^A-Z]+/, '') || '';
  switch (format.charAt(0)) {
    case 'S': return TrainerType.Supporter;
    case 'T': return TrainerType.Tool;
    case 'A': return TrainerType.Stadium;
    default: return TrainerType.Item;
  }
}

function abilityFor(info: CardInfo): Ability | undefined {
  const action = info.actions?.find((candidate) => candidate.kind === 'ability');
  if (!action) return undefined;
  const oncePerTurn = /once during your turn|once during each player's turn|once per turn/i.test(action.text);
  return {
    name: action.name,
    type: 'ability',
    trigger: oncePerTurn ? 'oncePerTurn' : 'passive',
    effects: [],
    description: action.text,
  };
}

function attacksFor(info: CardInfo): Attack[] {
  return (info.actions || [])
    .filter((action) => action.kind === 'attack')
    .map((action) => ({
      name: action.name,
      cost: energyCost(action.cost),
      damage: printedDamage(action.damage),
      description: action.text,
    }));
}

export function hiddenReviewCard(instanceId: string): TrainerCard {
  return {
    id: instanceId,
    name: 'Hidden card',
    cardType: CardType.Trainer,
    imageUrl: '',
    cardNumber: '',
    trainerType: TrainerType.Item,
  };
}

export function cardInfoToEngineCard(info: CardInfo | undefined, instanceId: string, fallbackName = 'Unknown card'): Card {
  if (!info) {
    return {
      ...hiddenReviewCard(instanceId),
      name: fallbackName,
    };
  }

  const base = {
    id: instanceId,
    name: info.name,
    // Canonical replay states repeat every card for every captured action.
    // Artwork remains in the shared catalog so base64 PNG data is not copied
    // into hundreds of in-memory engine-card snapshots.
    imageUrl: '',
    cardNumber: [info.setCode, info.number].filter(Boolean).join(' '),
    reviewSourceId: info.id,
    reviewRulesText: info.rulesText,
  };

  if (info.category === 1 || (info.hp != null && info.hp > 0)) {
    const rulebox = /\b(ex|V|VSTAR|VMAX)\b/i.test(info.name) || Boolean(info.format && /[^012]/.test(info.format));
    const pokemon: PokemonCard = {
      ...base,
      cardType: CardType.Pokemon,
      hp: info.hp || 0,
      stage: pokemonStage(info),
      type: energyType(info.cardType),
      weakness: info.weaknessType ? energyType(info.weaknessType) : undefined,
      resistance: info.resistanceType ? energyType(info.resistanceType) : undefined,
      resistanceValue: info.resistanceAmount ? -Math.abs(printedDamage(info.resistanceAmount)) : undefined,
      retreatCost: info.retreat || 0,
      attacks: attacksFor(info),
      ability: abilityFor(info),
      evolvesFrom: info.evolvesFrom || undefined,
      prizeCards: /VMAX/i.test(info.name) ? 3 : rulebox ? 2 : 1,
      isRulebox: rulebox,
      isTera: /Tera/i.test(info.rulesText || ''),
    };
    return pokemon;
  }

  if (info.category === 3 || /Energy$/i.test(info.name)) {
    const type = energyType(info.cardType || info.name.replace(/(?:Basic|Special|Energy)/gi, '').trim());
    const energy: EnergyCard = {
      ...base,
      cardType: CardType.Energy,
      energySubtype: /^Basic\b/i.test(info.name) ? EnergySubtype.Basic : EnergySubtype.Special,
      energyType: type,
      provides: [type],
    };
    return energy;
  }

  const trainer: TrainerCard = {
    ...base,
    cardType: CardType.Trainer,
    trainerType: trainerType(info),
  };
  return trainer;
}

export function cardRulesText(card: Card, info?: CardInfo): string {
  if (card.cardType === CardType.Pokemon) {
    const pokemon = card as PokemonCard;
    return [
      pokemon.ability ? `${pokemon.ability.name}: ${pokemon.ability.description}` : '',
      ...pokemon.attacks.map((attack) => `${attack.name}${attack.damage ? ` ${attack.damage}` : ''}: ${attack.description}`),
    ].filter(Boolean).join('\n');
  }
  return info?.rulesText || (card as Card & ReviewCardMetadata).reviewRulesText || '';
}

export function cardSourceIdFromReviewCard(card: Card): string | undefined {
  return (card as Card & ReviewCardMetadata).reviewSourceId;
}
