import { useState } from 'react';
import type { Card, PokemonCard, EnergyCard, TrainerCard } from '../engine/types.js';

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

function HandCard({ card }: { card: Card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const borderColor = CARD_TYPE_COLORS[card.cardType] || '#6B7280';
  const hasImage = card.imageUrl && !card.imageUrl.includes('example.com') && !imgFailed;

  return (
    <div
      className="flex-shrink-0 rounded-lg overflow-hidden cursor-default transition-all hover:scale-105 hover:z-10 hover:shadow-lg hover:shadow-black/40 relative group"
      style={{ width: 72, border: `2px solid ${borderColor}` }}
      title={card.name}
    >
      {hasImage ? (
        <img
          src={card.imageUrl}
          alt={card.name}
          className="w-full block"
          onError={() => setImgFailed(true)}
          loading="lazy"
        />
      ) : (
        <div className="bg-gray-800" style={{ minHeight: 100 }}>
          <div className="px-1 py-1 text-[8px] font-bold text-white" style={{ backgroundColor: borderColor + '33' }}>
            {card.name}
          </div>
          <div className="px-1 py-1">
            {card.cardType === 'Pokemon' && (
              <>
                <div className="flex items-center gap-0.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[(card as PokemonCard).type] || '#999' }} />
                  <span className="text-[7px] text-gray-400">{(card as PokemonCard).stage}</span>
                </div>
                <div className="text-[8px] text-gray-300 mt-0.5">HP {(card as PokemonCard).hp}</div>
              </>
            )}
            {card.cardType === 'Energy' && (
              <div className="flex items-center gap-1 mt-1">
                <div className="w-3 h-3 rounded-full border border-gray-600" style={{ backgroundColor: TYPE_COLORS[(card as EnergyCard).energyType] || '#999' }} />
                <span className="text-[7px] text-gray-400">{(card as EnergyCard).energyType}</span>
              </div>
            )}
            {card.cardType === 'Trainer' && (
              <div className="text-[7px] text-gray-500 mt-0.5">{(card as TrainerCard).trainerType || 'Trainer'}</div>
            )}
          </div>
        </div>
      )}
      {/* Name overlay on hover */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="text-[8px] font-bold text-white leading-tight truncate">{card.name}</div>
        {card.cardType === 'Pokemon' && (
          <div className="text-[7px] text-gray-300">HP {(card as PokemonCard).hp}</div>
        )}
      </div>
    </div>
  );
}

function DiscardCard({ card }: { card: Card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const borderColor = CARD_TYPE_COLORS[card.cardType] || '#6B7280';
  const hasImage = card.imageUrl && !card.imageUrl.includes('example.com') && !imgFailed;

  return (
    <div
      className="flex-shrink-0 rounded overflow-hidden cursor-default transition-all hover:scale-110 hover:z-10 relative group"
      style={{ width: 48, border: `1.5px solid ${borderColor}44`, opacity: 0.8 }}
      title={card.name}
    >
      {hasImage ? (
        <img
          src={card.imageUrl}
          alt={card.name}
          className="w-full block"
          onError={() => setImgFailed(true)}
          loading="lazy"
          style={{ filter: 'brightness(0.7) saturate(0.7)' }}
        />
      ) : (
        <div className="bg-gray-800/60" style={{ minHeight: 66 }}>
          <div className="px-0.5 py-0.5 text-[6px] font-bold text-gray-400 truncate" style={{ backgroundColor: borderColor + '22' }}>
            {card.name}
          </div>
        </div>
      )}
      {/* Name on hover */}
      <div className="absolute inset-x-0 bottom-0 bg-black/80 px-0.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="text-[6px] font-bold text-white truncate">{card.name}</div>
      </div>
    </div>
  );
}

export function HandZone({
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

  // Group cards by type for the count badges
  const pokemonCount = cards.filter(c => c.cardType === 'Pokemon').length;
  const trainerCount = cards.filter(c => c.cardType === 'Trainer').length;
  const energyCount = cards.filter(c => c.cardType === 'Energy').length;

  return (
    <div className="bg-gray-800/40 rounded-lg border border-gray-700/50">
      <button
        className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-gray-800/50 transition-colors rounded-t-lg"
        onClick={onToggle}
      >
        <span className="text-[10px] text-gray-500">{isExpanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">{title}</span>
        <span className="text-[11px] text-white font-bold font-mono bg-gray-700 px-1.5 rounded">{cards.length}</span>
        {isExpanded && cards.length > 0 && (
          <div className="flex gap-1 ml-1">
            {pokemonCount > 0 && (
              <span className="text-[8px] px-1 rounded" style={{ backgroundColor: '#EF444422', color: '#EF4444' }}>
                {pokemonCount} Pkm
              </span>
            )}
            {trainerCount > 0 && (
              <span className="text-[8px] px-1 rounded" style={{ backgroundColor: '#3B82F622', color: '#3B82F6' }}>
                {trainerCount} Trn
              </span>
            )}
            {energyCount > 0 && (
              <span className="text-[8px] px-1 rounded" style={{ backgroundColor: '#EAB30822', color: '#EAB308' }}>
                {energyCount} Nrg
              </span>
            )}
          </div>
        )}
      </button>
      {isExpanded && cards.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 pt-1" style={{ scrollbarWidth: 'thin' }}>
          {cards.map((card, i) => (
            <HandCard key={`${card.id}-${i}`} card={card} />
          ))}
        </div>
      )}
      {isExpanded && cards.length === 0 && (
        <div className="text-[10px] text-gray-600 px-4 py-2">No cards in hand</div>
      )}
    </div>
  );
}

export function DiscardZone({
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
  const isExpanded = expanded ?? false;

  if (cards.length === 0 && !isExpanded) {
    return (
      <button
        className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] text-gray-600 hover:text-gray-400 transition-colors"
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className="font-mono">0</span>
      </button>
    );
  }

  return (
    <div className="bg-gray-800/20 rounded border border-gray-700/30">
      <button
        className="flex items-center gap-1.5 w-full text-left px-2 py-1 hover:bg-gray-800/30 transition-colors rounded"
        onClick={onToggle}
      >
        <span className="text-[9px] text-gray-600">{isExpanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">{title}</span>
        <span className="text-[9px] text-gray-500 font-mono">{cards.length}</span>
      </button>
      {isExpanded && cards.length > 0 && (
        <div className="flex gap-0.5 overflow-x-auto px-2 pb-1.5 pt-0.5 flex-wrap" style={{ scrollbarWidth: 'thin' }}>
          {cards.map((card, i) => (
            <DiscardCard key={`${card.id}-${i}`} card={card} />
          ))}
        </div>
      )}
      {isExpanded && cards.length === 0 && (
        <div className="text-[9px] text-gray-700 px-3 py-1">Empty</div>
      )}
    </div>
  );
}

// Keep backward compat export
export const CardZone = HandZone;
