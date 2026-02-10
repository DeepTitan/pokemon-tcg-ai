import type { PokemonInPlay } from '../engine/types.js';

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

const STATUS_COLORS: Record<string, string> = {
  Poisoned: '#A855F7',
  Burned: '#EF4444',
  Asleep: '#6B7280',
  Confused: '#EAB308',
  Paralyzed: '#F59E0B',
};

export function ActivePokemonDetail({
  pokemon,
  playerIndex,
}: {
  pokemon: PokemonInPlay | null;
  playerIndex: 0 | 1;
}) {
  if (!pokemon) {
    return (
      <div className="w-48 h-56 bg-gray-800 rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center">
        <span className="text-gray-600 text-sm">No Active</span>
      </div>
    );
  }

  const card = pokemon.card;
  const hpPct = Math.max(0, pokemon.currentHp / card.hp);
  const hpColor = hpPct > 0.5 ? '#22C55E' : hpPct > 0.25 ? '#EAB308' : '#EF4444';
  const typeColor = TYPE_COLORS[card.type] || TYPE_COLORS.Colorless;

  return (
    <div className="w-48 bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 flex items-center justify-between" style={{ backgroundColor: typeColor + '22', borderBottom: `2px solid ${typeColor}44` }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor }} />
          <span className="font-bold text-white text-xs truncate">{card.name}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {card.isRulebox && (
            <span className="text-[8px] px-1 py-px rounded font-bold" style={{ backgroundColor: '#EAB30833', color: '#EAB308' }}>
              ex
            </span>
          )}
          <span className="text-[9px] text-gray-400">{card.stage}</span>
        </div>
      </div>

      {/* HP bar */}
      <div className="px-3 py-1.5">
        <div className="flex justify-between text-[10px] mb-0.5">
          <span className="text-gray-400">HP</span>
          <span className="font-mono font-bold" style={{ color: hpColor }}>
            {pokemon.currentHp} / {card.hp}
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="h-2 rounded-full transition-all duration-300"
            style={{ width: `${hpPct * 100}%`, backgroundColor: hpColor }}
          />
        </div>
      </div>

      {/* Energy */}
      {pokemon.attachedEnergy.length > 0 && (
        <div className="px-3 py-1 flex items-center gap-1 flex-wrap">
          <span className="text-[9px] text-gray-500">Energy:</span>
          {pokemon.attachedEnergy.map((e, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0"
              style={{ backgroundColor: TYPE_COLORS[e.energyType] || '#666' }}
              title={e.energyType}
            />
          ))}
        </div>
      )}

      {/* Status conditions */}
      {pokemon.statusConditions.length > 0 && (
        <div className="px-3 py-1 flex gap-1 flex-wrap">
          {pokemon.statusConditions.map((status, i) => (
            <span
              key={i}
              className="text-[8px] px-1.5 py-0.5 rounded-full font-bold"
              style={{
                backgroundColor: (STATUS_COLORS[status] || '#666') + '33',
                color: STATUS_COLORS[status] || '#999',
              }}
            >
              {status}
            </span>
          ))}
        </div>
      )}

      {/* Attacks */}
      <div className="px-3 py-1.5 space-y-1 border-t border-gray-700/50">
        {card.attacks.map((atk, i) => (
          <div key={i} className="flex items-start gap-1.5">
            {/* Energy cost dots */}
            <div className="flex gap-px flex-shrink-0 mt-0.5">
              {atk.cost.map((energyType, j) => (
                <div
                  key={j}
                  className="w-3 h-3 rounded-full border border-gray-600"
                  style={{ backgroundColor: TYPE_COLORS[energyType] || '#666' }}
                />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-200 font-medium truncate">{atk.name}</span>
                {atk.damage > 0 && (
                  <span className="text-[10px] font-bold text-red-400 flex-shrink-0 ml-1">{atk.damage}</span>
                )}
              </div>
              {atk.description && (
                <div className="text-[8px] text-gray-500 leading-tight">{atk.description}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer: weakness, resistance, retreat */}
      <div className="px-3 py-1 border-t border-gray-700/50 flex justify-between text-[8px] text-gray-500">
        {card.weakness && (
          <span>
            Weak: <span style={{ color: TYPE_COLORS[card.weakness] || '#999' }}>{card.weakness}</span>
          </span>
        )}
        {card.resistance && (
          <span>
            Resist: <span style={{ color: TYPE_COLORS[card.resistance] || '#999' }}>{card.resistance}</span> {card.resistanceValue}
          </span>
        )}
        <span>Retreat: {card.retreatCost}</span>
      </div>

      {/* Prize value */}
      {card.prizeCards > 1 && (
        <div className="px-3 py-0.5 text-[8px] text-center" style={{ backgroundColor: '#EAB30811', color: '#EAB308' }}>
          Worth {card.prizeCards} prize cards
        </div>
      )}
    </div>
  );
}
