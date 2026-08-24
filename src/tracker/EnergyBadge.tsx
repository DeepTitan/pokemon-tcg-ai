import { EnergyType } from '../engine/types.js';

const ENERGY_CODES: Record<string, EnergyType> = {
  R: EnergyType.Fire,
  W: EnergyType.Water,
  G: EnergyType.Grass,
  L: EnergyType.Lightning,
  P: EnergyType.Psychic,
  F: EnergyType.Fighting,
  D: EnergyType.Dark,
  M: EnergyType.Metal,
  N: EnergyType.Dragon,
  Y: EnergyType.Fairy,
  C: EnergyType.Colorless,
};

const ENERGY_LABELS: Record<EnergyType, string> = {
  [EnergyType.Fire]: 'Fire',
  [EnergyType.Water]: 'Water',
  [EnergyType.Grass]: 'Grass',
  [EnergyType.Lightning]: 'Lightning',
  [EnergyType.Psychic]: 'Psychic',
  [EnergyType.Fighting]: 'Fighting',
  [EnergyType.Dark]: 'Darkness',
  [EnergyType.Metal]: 'Metal',
  [EnergyType.Dragon]: 'Dragon',
  [EnergyType.Fairy]: 'Fairy',
  [EnergyType.Colorless]: 'Colorless',
};

const ENERGY_SYMBOLS: Record<EnergyType, string> = {
  [EnergyType.Fire]: 'R',
  [EnergyType.Water]: 'W',
  [EnergyType.Grass]: 'G',
  [EnergyType.Lightning]: 'L',
  [EnergyType.Psychic]: 'P',
  [EnergyType.Fighting]: 'F',
  [EnergyType.Dark]: 'D',
  [EnergyType.Metal]: 'M',
  [EnergyType.Dragon]: 'N',
  [EnergyType.Fairy]: 'Y',
  [EnergyType.Colorless]: 'C',
};

function EnergyGlyph({ type }: { type: EnergyType }) {
  let glyph;
  switch (type) {
    case EnergyType.Fire:
      glyph = <path d="M11.7 1.4c.5 3-1.8 4.2-2.7 6.2-.6-1-.8-2.1-.4-3.5C5.8 6.2 4.1 8.7 4.2 12c.1 3.7 2.7 6.1 5.9 6.1 3.4 0 5.9-2.6 5.8-6.2-.1-3.2-2-6.9-4.2-10.5Zm-1.4 14.4c-1.6 0-2.7-1.2-2.7-2.8 0-1.2.6-2.2 1.8-3.3.1 1.3.7 2.1 1.4 2.7.5-.8.8-1.7.7-2.8 1.1 1 1.7 2.1 1.7 3.4 0 1.6-1.3 2.8-2.9 2.8Z" />;
      break;
    case EnergyType.Water:
      glyph = <path d="M10 1.4C8.2 4 4.3 8.2 4.3 12.1A5.7 5.7 0 0 0 10 17.8a5.7 5.7 0 0 0 5.7-5.7C15.7 8.2 11.8 4 10 1.4Zm2.9 12.1c-.8 1.2-2.4 1.7-3.7 1.1-.5-.2-.6-.9-.2-1.2.3-.2.7-.2 1 0 .6.2 1.3 0 1.7-.5.2-.4.8-.5 1.1-.2.3.2.4.6.1.8Z" />;
      break;
    case EnergyType.Grass:
      glyph = <path d="M17.3 2.7C11.9 2.5 6.9 4.2 4.4 7.5c-2.1 2.7-1.4 5.8.8 7.2l-1.7 2.1 1.8 1.1 1.6-2.2c2.2.9 4.8.1 6.4-2.1 2.4-3.1 3.3-7.2 4-10.9Zm-3.5 2.8c-2.2 2.1-4.5 4.3-6.9 7.2-.4.5-1.4-.3-1-.8 2.3-2.9 4.9-5.2 7.4-7.1.5-.4.9.3.5.7Z" />;
      break;
    case EnergyType.Lightning:
      glyph = <path d="M11.7 1 4.4 11h4.4l-1 8 7.8-11h-4.7l.8-7Z" />;
      break;
    case EnergyType.Psychic:
      glyph = <><path fillRule="evenodd" d="M1.5 10s3.1-5.4 8.5-5.4 8.5 5.4 8.5 5.4-3.1 5.4-8.5 5.4S1.5 10 1.5 10Zm8.5 3.3A3.3 3.3 0 1 0 10 6.7a3.3 3.3 0 0 0 0 6.6Z" /><circle cx="10" cy="10" r="1.7" /></>;
      break;
    case EnergyType.Fighting:
      glyph = <path d="M5.5 3.1h2.3v5H5.5v-5Zm2.9-1h2.4v6H8.4v-6Zm3 1h2.3v5h-2.3v-5Zm2.9 1.7h2.2v6.1c0 4.2-2.4 6.8-6.5 6.8-3.6 0-6.5-2.4-6.5-6V7.5c0-1 .8-1.8 1.8-1.8h.2v3.9h5.2c1 0 1.8.8 1.8 1.8v.4H7.7v1.8H11c2 0 3.3-1.5 3.3-3.4V4.8Z" />;
      break;
    case EnergyType.Dark:
      glyph = <path fillRule="evenodd" d="M15.7 2.5A8 8 0 1 0 18 13.8a7 7 0 1 1-2.3-11.3ZM4.6 9.2l2.2-.5L8 6.8l1.2 1.9 2.2.5-1.5 1.7.2 2.2L8 12.2l-2.1.9.2-2.2-1.5-1.7Z" />;
      break;
    case EnergyType.Metal:
      glyph = <><path fillRule="evenodd" d="m10 1.4 2 2.1 2.9-.3.4 2.9 2.5 1.5-1.5 2.5.8 2.8-2.8.8-1 2.7-2.7-1-2.4 1.6-1.8-2.3-2.9-.1.1-2.9-2.2-1.9 1.8-2.3-.5-2.8 2.8-.7L7.2 2 10 1.4Zm0 11.7a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z" /><circle cx="10" cy="10" r="1.4" /></>;
      break;
    case EnergyType.Dragon:
      glyph = <path d="m10 1.4 2.1 5.2 5.6-1.1-3.5 4.4 3.5 4.4-5.6-1.1-2.1 5.2-2.1-5.2-5.6 1.1 3.5-4.4-3.5-4.4 5.6 1.1L10 1.4Z" />;
      break;
    case EnergyType.Fairy:
      glyph = <path d="m10 1.2 1.7 5.5L17 4.5l-2.2 5.3 5.5 1.7-5.5 1.7 2.2 5.3-5.3-2.2-1.7 5.5-1.7-5.5L3 18.5l2.2-5.3-5.5-1.7 5.5-1.7L3 4.5l5.3 2.2L10 1.2Z" transform="scale(.82) translate(2.2 2.2)" />;
      break;
    default:
      glyph = <path d="m10 1.8 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8L10 1.8Z" />;
  }
  return <svg className="energy-glyph" viewBox="0 0 20 20" aria-hidden="true">{glyph}</svg>;
}

export function energyTypeLabel(type: EnergyType): string {
  return ENERGY_LABELS[type];
}

export function findEnergyType(...values: Array<string | undefined>): EnergyType | undefined {
  for (const value of values) {
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    const code = ENERGY_CODES[value.trim().toUpperCase()];
    if (code) return code;
    for (const match of value.matchAll(/\{([^}]+)\}/g)) {
      const bracedCode = [...match[1].toUpperCase()].map((candidate) => ENERGY_CODES[candidate]).find(Boolean);
      if (bracedCode) return bracedCode;
    }
    if (/darkness|\bdark\b/.test(normalized)) return EnergyType.Dark;
    for (const type of Object.values(EnergyType)) {
      if (normalized === type.toLowerCase() || normalized.includes(type.toLowerCase())) return type;
    }
  }
  return undefined;
}

export function resolveEnergyType(...values: Array<string | undefined>): EnergyType {
  return findEnergyType(...values) || EnergyType.Colorless;
}

export function countEnergyTypes(types: EnergyType[]): Array<{ type: EnergyType; count: number }> {
  const grouped = new Map<EnergyType, number>();
  types.forEach((type) => grouped.set(type, (grouped.get(type) || 0) + 1));
  return [...grouped].map(([type, count]) => ({ type, count }));
}

export function EnergyBadge({ type, count = 1, compact = false }: { type: EnergyType; count?: number; compact?: boolean }) {
  const label = energyTypeLabel(type);
  const cssType = type.toLowerCase();
  return (
    <span className={`energy-type-badge energy-${cssType} ${compact ? 'compact' : ''}`} title={`${label} Energy${count > 1 ? ` ×${count}` : ''}`} aria-label={`${label} Energy${count > 1 ? `, ${count} attached` : ' attached'}`}>
      <i aria-hidden="true">{compact ? <EnergyGlyph type={type} /> : ENERGY_SYMBOLS[type]}</i>
      {compact ? count > 1 && <small className="attached-energy-count">{count}</small> : <span><b>{label}</b>{count > 1 && <small>×{count}</small>}</span>}
    </span>
  );
}
