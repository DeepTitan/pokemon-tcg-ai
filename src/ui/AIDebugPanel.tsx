import type { AISearchResult } from '../ai/ai-bridge.js';
import type { AIMode } from '../ai/ai-bridge.js';
import { getModel } from '../ai/ai-bridge.js';
import type { GameState, Action } from '../engine/types.js';

function describeActionShort(action: Action, state: GameState | null): string {
  if (!state) return action.type;
  const player = state.players[action.player];
  switch (action.type) {
    case 'Attack': {
      const active = player.active;
      const atk = active?.card.attacks[action.payload.attackIndex];
      return `Attack: ${atk?.name ?? '???'} (${atk?.damage ?? 0} dmg)`;
    }
    case 'PlayPokemon': {
      const card = player.hand[action.payload.handIndex];
      return `Play ${card?.name ?? '???'}`;
    }
    case 'AttachEnergy':
      return `Attach energy -> ${action.payload.target}`;
    case 'PlayTrainer': {
      const card = player.hand[action.payload.handIndex];
      return `Trainer: ${card?.name ?? '???'}`;
    }
    case 'Retreat': {
      const bench = player.bench[action.payload.benchIndex];
      return `Retreat -> ${bench?.card.name ?? '???'}`;
    }
    case 'Pass':
      return 'Pass';
    default:
      return action.type;
  }
}

export function AIDebugPanel({
  searchResult,
  isSearching,
  searchProgress,
  aiMode,
  gameState,
}: {
  searchResult: AISearchResult | null;
  isSearching: boolean;
  searchProgress: number;
  aiMode: AIMode;
  gameState: GameState | null;
}) {
  return (
    <div className="flex flex-col h-full text-xs">
      {/* Mode indicator */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <span className="font-bold text-purple-400">AI: {getModel(aiMode)?.name ?? aiMode}</span>
        {searchResult && aiMode !== 'heuristic' && (
          <span className="text-gray-500">{searchResult.searchTimeMs.toFixed(0)}ms</span>
        )}
      </div>

      {/* Thinking indicator */}
      {isSearching && (
        <div className="px-3 py-2 border-b border-gray-700">
          <div className="flex items-center gap-2 text-yellow-400 mb-1">
            <span className="animate-spin text-sm">&#9881;</span>
            <span>Thinking...</span>
            <span className="text-gray-500">
              {Math.round(searchProgress * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1">
            <div
              className="h-1 rounded-full bg-yellow-400 transition-all duration-200"
              style={{ width: `${searchProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Search summary */}
      {searchResult && aiMode !== 'heuristic' && (
        <div className="px-3 py-2 border-b border-gray-700 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Nodes</span>
            <span className="text-white font-mono">{searchResult.nodeCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Config</span>
            <span className="text-gray-300 font-mono">
              {searchResult.config.determinizations}d x {searchResult.config.simulations}s
            </span>
          </div>
          {/* Value estimate bar */}
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Value</span>
            <span className={`font-mono font-bold ${searchResult.value > 0 ? 'text-green-400' : searchResult.value < 0 ? 'text-red-400' : 'text-gray-400'}`}>
              {searchResult.value > 0 ? '+' : ''}{searchResult.value.toFixed(3)}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 relative">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: `${((searchResult.value + 1) / 2) * 100}%`,
                backgroundColor: searchResult.value > 0 ? '#22C55E' : searchResult.value < -0.1 ? '#EF4444' : '#EAB308',
              }}
            />
            {/* Center marker */}
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-500" />
          </div>
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>P{(gameState?.currentPlayer ?? 0) + 1} losing</span>
            <span>P{(gameState?.currentPlayer ?? 0) + 1} winning</span>
          </div>
        </div>
      )}

      {/* Action ranking table */}
      {searchResult && searchResult.childStats.length > 0 && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-3 py-1.5 border-b border-gray-700 text-gray-500 font-bold uppercase tracking-wider text-[9px]">
            Action Rankings
          </div>
          <div className="px-2">
            {searchResult.childStats.slice(0, 15).map((stat, i) => {
              const isChosen = i === 0;
              return (
                <div
                  key={stat.actionKey}
                  className={`py-1.5 border-b border-gray-800 ${isChosen ? 'bg-green-900/20' : ''}`}
                >
                  <div className="flex items-start gap-1.5">
                    <span className={`font-mono w-4 text-right flex-shrink-0 ${isChosen ? 'text-green-400 font-bold' : 'text-gray-600'}`}>
                      {i + 1}
                    </span>
                    <span className={`flex-1 min-w-0 break-words ${isChosen ? 'text-green-300' : 'text-gray-300'}`}>
                      {describeActionShort(stat.action, gameState)}
                    </span>
                  </div>
                  <div className="flex gap-2 ml-5 mt-0.5 text-[9px]">
                    <span className="text-gray-500">
                      V:<span className="text-white font-mono">{stat.visitCount}</span>
                    </span>
                    <span className="text-gray-500">
                      Q:<span className={`font-mono ${stat.meanValue > 0 ? 'text-green-400' : stat.meanValue < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {stat.meanValue > 0 ? '+' : ''}{stat.meanValue.toFixed(2)}
                      </span>
                    </span>
                    <span className="text-gray-500">
                      P:<span className="text-blue-400 font-mono">{(stat.prior * 100).toFixed(0)}%</span>
                    </span>
                    <span className="text-gray-500">
                      &#960;:<span className="text-purple-400 font-mono">{(stat.probability * 100).toFixed(0)}%</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!searchResult && !isSearching && (
        <div className="flex-1 flex items-center justify-center text-gray-600 px-4 text-center">
          {aiMode === 'heuristic'
            ? 'Switch to ISMCTS mode to see AI analysis'
            : 'Step or play to see AI search results'}
        </div>
      )}
    </div>
  );
}
