import type { CardActionInfo, CardInfo, TrackerEvent } from './types.js';

export interface CardEffectSummary {
  label: string;
  title: string;
  text: string;
}

function cleanCardText(candidate: string): string {
  return candidate
    .replace(/\{ex\}/gi, 'ex')
    .replace(/\bV_atk\b/g, 'V')
    .replace(/\s+/g, ' ')
    .trim();
}

function actionNamedInEvent(event: TrackerEvent, actions: CardActionInfo[]): CardActionInfo | undefined {
  const copy = event.text.toLocaleLowerCase();
  return actions.find((action) => copy.includes(action.name.toLocaleLowerCase()))
    || (actions.length === 1 ? actions[0] : undefined);
}

function trainerEffectLabel(info: CardInfo): string {
  const format = info.format?.toUpperCase().replace(/^[^A-Z]+/, '') || '';
  if (format.startsWith('A')) return 'Stadium effect';
  if (format.startsWith('T')) return 'Pokémon Tool effect';
  if (format.startsWith('S')) return 'Supporter effect';
  return 'Item effect';
}

/**
 * Resolves the printed effect that caused a captured event. This is shared by
 * every timeline event instead of relying on card-specific UI exceptions.
 */
export function cardEffectSummary(event: TrackerEvent, info: CardInfo | undefined): CardEffectSummary | undefined {
  if (!info) return undefined;

  const actions = info.actions || [];
  const attacks = actions.filter((action) => action.kind === 'attack');
  const abilities = actions.filter((action) => action.kind === 'ability');
  const eventMentionsAttack = event.kind === 'attack'
    || event.kind === 'damage'
    || event.kind === 'knockout'
    || attacks.some((action) => event.text.toLocaleLowerCase().includes(action.name.toLocaleLowerCase()));
  const eventMentionsAbility = event.kind === 'ability'
    || abilities.some((action) => event.text.toLocaleLowerCase().includes(action.name.toLocaleLowerCase()));

  if (eventMentionsAttack) {
    const action = actionNamedInEvent(event, attacks);
    const copy = action ? cleanCardText(action.text) : '';
    if (action && copy) return { label: 'Attack effect', title: action.name, text: copy };
  }

  if (eventMentionsAbility) {
    const action = actionNamedInEvent(event, abilities);
    const copy = action ? cleanCardText(action.text) : '';
    if (action && copy) return { label: 'Ability effect', title: action.name, text: copy };
  }

  const rules = cleanCardText(info.rulesText || actions.find((action) => action.kind === 'rule')?.text || '');
  if (!rules) return undefined;

  const isPokemon = info.category === 1 || (info.hp || 0) > 0;
  if (isPokemon) return undefined;
  const isEnergy = info.category === 3 || /Energy$/i.test(info.name);
  return {
    label: isEnergy ? 'Energy effect' : trainerEffectLabel(info),
    title: info.name,
    text: rules,
  };
}
