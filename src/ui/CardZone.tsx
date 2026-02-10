import type { Card, PokemonCard, EnergyCard } from '../engine/types.js';

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

const CARD_TYPE_COLORS: Record<string, string> = {
  Pokemon: '#EF4444',
  Trainer: '#3B82F6',
  Energy: '#EAB308',
};

function CardThumbnail({ card }: { card: Card }) {
  const borderColor = CARD_TYPE_COLORS[card.cardType] || '#6B7280';
  const isPokemon = card.cardType === 'Pokemon';
  const isEnergy = card.cardType === 'Energy';

  return (
    <div
      className="flex-shrink-0 w-16 rounded bg-gray-800 border overflow-hidden cursor-default hover:brightness-125 transition-all"
      style={{ borderColor, minHeight: 72 }}
      title={card.name}
    >
      <div className="px-1 py-0.5 text-[8px] font-bold truncate text-white" style={{ backgroundColor: borderColor + '33' }}>
        {card.name}
      </div>
      <div className="px-1 py-0.5">
        {isPokemon && (
          <>
            <div className="flex items-center gap-0.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: TYPE_COLORS[(card as PokemonCard).type] || '#999' }}
              />
              <span className="text-[7px] text-gray-400">{(card as PokemonCard).stage}</span>
            </div>
            <div className="text-[8px] text-gray-300 mt-0.5">
              HP {(card as PokemonCard).hp}
            </div>
          </>
        )}
        {isEnergy && (
          <div className="flex items-center gap-1 mt-1">
            <div
              className="w-3 h-3 rounded-full border border-gray-600"
              style={{ backgroundColor: TYPE_COLORS[(card as EnergyCard).energyType] || '#999' }}
            />
            <span className="text-[7px] text-gray-400">{(card as EnergyCard).energyType}</span>
          </div>
        )}
        {!isPokemon && !isEnergy && (
          <div className="text-[7px] text-gray-500 mt-0.5">
            {(card as any).trainerType || 'Trainer'}
          </div>
        )}
      </div>
    </div>
  );
}

export function CardZone({
  cards,
  title,
  expanded,
  onToggle,
}: {
  cards: Card[];
  title: string;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const isExpanded = expanded ?? true;

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left px-2 py-1 hover:bg-gray-800/50 transition-colors rounded"
        onClick={onToggle}
      >
        <span className="text-[10px] text-gray-500 w-3">{isExpanded ? '&#9660;' : '&#9654;'}</span>
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{title}</span>
        <span className="text-[10px] text-gray-600 font-mono">{cards.length}</span>
      </button>
      {isExpanded && cards.length > 0 && (
        <div className="flex gap-1 overflow-x-auto px-2 pb-1" style={{ scrollbarWidth: 'thin' }}>
          {cards.map((card, i) => (
            <CardThumbnail key={`${card.id}-${i}`} card={card} />
          ))}
        </div>
      )}
      {isExpanded && cards.length === 0 && (
        <div className="text-[9px] text-gray-700 px-4 py-1">Empty</div>
      )}
    </div>
  );
}
