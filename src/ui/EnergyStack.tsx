import type { EnergyCard } from '../engine/types.js';

const TYPE_COLORS: Record<string, string> = {
  Fire: '#FF6B35',
  Water: '#3B82F6',
  Grass: '#22C55E',
  Lightning: '#EAB308',
  Psychic: '#A855F7',
  Fighting: '#D97706',
  Dark: '#6B7280',
  Metal: '#94A3B8',
  Dragon: '#7C3AED',
  Fairy: '#EC4899',
  Colorless: '#9CA3AF',
};

const ENERGY_ABBREV: Record<string, string> = {
  Fire: 'F',
  Water: 'W',
  Grass: 'G',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'K',
  Dark: 'D',
  Metal: 'M',
  Dragon: 'N',
  Fairy: 'Y',
  Colorless: 'C',
};

const VARIANTS = {
  active: { width: 20, height: 28, radius: 3, fontSize: 8, offset: 6, inset: 2 },
  bench: { width: 14, height: 20, radius: 2, fontSize: 6, offset: 4, inset: 1 },
} as const;

export function EnergyStack({
  energy,
  variant,
}: {
  energy: EnergyCard[];
  variant: 'active' | 'bench';
}) {
  if (energy.length === 0) return null;

  const v = VARIANTS[variant];
  const stackHeight = v.height + v.offset * (energy.length - 1);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        bottom: v.inset,
        right: v.inset,
        width: v.width,
        height: stackHeight,
      }}
    >
      {energy.map((e, i) => {
        const color = TYPE_COLORS[e.energyType] || '#666';
        return (
          <div
            key={i}
            className="absolute flex items-center justify-center"
            style={{
              width: v.width,
              height: v.height,
              borderRadius: v.radius,
              backgroundColor: color,
              border: '1px solid rgba(255,255,255,0.3)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
              bottom: i * v.offset,
              right: 0,
              zIndex: i,
            }}
            title={e.energyType}
          >
            <span
              className="font-bold text-white leading-none"
              style={{
                fontSize: v.fontSize,
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
              }}
            >
              {ENERGY_ABBREV[e.energyType] || '?'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
