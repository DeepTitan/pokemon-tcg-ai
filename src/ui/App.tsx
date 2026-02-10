import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '../engine/game-engine.js';
import { buildCharizardDeck } from '../engine/charizard-deck.js';
import type {
  GameState,
  PokemonInPlay,
  PokemonCard,
  EnergyCard,
  Card,
  Action,
} from '../engine/types.js';
import { GamePhase, ActionType, CardType } from '../engine/types.js';

// ============================================================================
// TYPES
// ============================================================================

interface GameLogEntry {
  turn: number;
  player: number;
  text: string;
  type: 'attack' | 'play' | 'energy' | 'trainer' | 'ko' | 'pass' | 'info';
}

// ============================================================================
// AI ACTION SELECTION (same heuristic as terminal play.ts)
// ============================================================================

function selectAction(state: GameState, actions: Action[]): Action {
  if (state.phase === GamePhase.AttackPhase) {
    const attacks = actions.filter(a => a.type === ActionType.Attack);
    if (attacks.length > 0) {
      const active = state.players[state.currentPlayer].active;
      if (active) {
        return attacks.reduce((best, a) => {
          const dmgA = active.card.attacks[a.payload.attackIndex]?.damage ?? 0;
          const dmgB = active.card.attacks[best.payload.attackIndex]?.damage ?? 0;
          return dmgA > dmgB ? a : best;
        });
      }
      return attacks[0];
    }
    return actions.find(a => a.type === ActionType.Pass) || actions[0];
  }

  const playPokemon = actions.filter(a => a.type === ActionType.PlayPokemon);
  const attachEnergy = actions.filter(a => a.type === ActionType.AttachEnergy);
  const playTrainer = actions.filter(a => a.type === ActionType.PlayTrainer);

  if (playPokemon.length > 0) {
    return playPokemon[Math.floor(Math.random() * playPokemon.length)];
  }
  if (attachEnergy.length > 0) {
    const toActive = attachEnergy.filter(a => a.payload.target === 'active');
    if (toActive.length > 0) return toActive[0];
    return attachEnergy[0];
  }
  if (playTrainer.length > 0) {
    return playTrainer[Math.floor(Math.random() * playTrainer.length)];
  }
  return actions.find(a => a.type === ActionType.Pass) || actions[0];
}

// ============================================================================
// HELPERS
// ============================================================================

function describeAction(action: Action, state: GameState): GameLogEntry {
  const player = action.player;
  const turn = state.turnNumber;

  switch (action.type) {
    case ActionType.Attack: {
      const active = state.players[player].active;
      const atk = active?.card.attacks[action.payload.attackIndex];
      return { turn, player, text: `${active?.card.name} uses ${atk?.name} for ${atk?.damage} dmg`, type: 'attack' };
    }
    case ActionType.PlayPokemon: {
      const card = state.players[player].hand[action.payload.handIndex];
      return { turn, player, text: `Plays ${card?.name || '???'} to bench`, type: 'play' };
    }
    case ActionType.AttachEnergy: {
      return { turn, player, text: `Attaches energy to ${action.payload.target}`, type: 'energy' };
    }
    case ActionType.PlayTrainer: {
      const card = state.players[player].hand[action.payload.handIndex];
      return { turn, player, text: `Plays ${card?.name || '???'}`, type: 'trainer' };
    }
    case ActionType.Retreat: {
      const bench = state.players[player].bench[action.payload.benchIndex];
      return { turn, player, text: `Retreats to ${bench?.card.name || '???'}`, type: 'play' };
    }
    case ActionType.Pass:
      return { turn, player, text: 'Passes', type: 'pass' };
    default:
      return { turn, player, text: action.type, type: 'info' };
  }
}

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

const LOG_COLORS: Record<string, string> = {
  attack: '#EF4444',
  play: '#22C55E',
  energy: '#EAB308',
  trainer: '#06B6D4',
  ko: '#F97316',
  pass: '#6B7280',
  info: '#9CA3AF',
};

// ============================================================================
// CARD IMAGE COMPONENT
// ============================================================================

function CardImage({ src, name, className }: { src: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed || !src || src.includes('example.com')) {
    return (
      <div className={`bg-gray-700 rounded-lg flex items-center justify-center border border-gray-600 ${className || ''}`}
        style={{ minHeight: 80 }}>
        <span className="text-xs text-gray-400 text-center px-1">{name}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className={`rounded-lg shadow-md ${className || ''}`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

// ============================================================================
// POKEMON CARD DISPLAY
// ============================================================================

function PokemonDisplay({ pokemon, isActive, label }: {
  pokemon: PokemonInPlay | null;
  isActive: boolean;
  label?: string;
}) {
  if (!pokemon) {
    return (
      <div className={`${isActive ? 'w-36' : 'w-24'} flex flex-col items-center`}>
        <div className={`${isActive ? 'w-36 h-48' : 'w-24 h-32'} bg-gray-800 rounded-lg border-2 border-dashed border-gray-700 flex items-center justify-center`}>
          <span className="text-gray-600 text-xs">Empty</span>
        </div>
      </div>
    );
  }

  const hpPct = Math.max(0, pokemon.currentHp / pokemon.card.hp);
  const hpColor = hpPct > 0.5 ? '#22C55E' : hpPct > 0.25 ? '#EAB308' : '#EF4444';
  const typeColor = TYPE_COLORS[pokemon.card.type] || TYPE_COLORS.Colorless;
  const isEx = pokemon.card.isRulebox;

  return (
    <div className={`${isActive ? 'w-36' : 'w-24'} flex flex-col items-center gap-1`}>
      {label && <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>}

      {/* Card image */}
      <div className="relative" style={{ border: isEx ? '2px solid #EAB308' : '2px solid transparent', borderRadius: 10 }}>
        <CardImage
          src={pokemon.card.imageUrl}
          name={pokemon.card.name}
          className={isActive ? 'w-36' : 'w-24'}
        />
        {/* HP overlay */}
        {isActive && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 rounded-b-lg p-1">
            <div className="flex justify-between items-center text-[10px] mb-0.5">
              <span className="font-bold text-white truncate">{pokemon.card.name}</span>
              <span className="text-gray-300">{pokemon.currentHp}/{pokemon.card.hp}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div className="h-1.5 rounded-full transition-all duration-300" style={{ width: `${hpPct * 100}%`, backgroundColor: hpColor }} />
            </div>
          </div>
        )}
      </div>

      {/* Energy display */}
      {pokemon.attachedEnergy.length > 0 && (
        <div className="flex gap-0.5 flex-wrap justify-center">
          {pokemon.attachedEnergy.map((e, i) => (
            <div key={i} className="w-4 h-4 rounded-full border border-gray-600 flex items-center justify-center text-[8px]"
              style={{ backgroundColor: TYPE_COLORS[e.energyType] || '#666' }}>
            </div>
          ))}
        </div>
      )}

      {/* Bench: compact name + HP */}
      {!isActive && (
        <div className="text-center">
          <div className="text-[10px] text-gray-300 font-medium truncate w-24">{pokemon.card.name}</div>
          <div className="w-full bg-gray-700 rounded-full h-1 mt-0.5">
            <div className="h-1 rounded-full" style={{ width: `${hpPct * 100}%`, backgroundColor: hpColor }} />
          </div>
          <div className="text-[9px] text-gray-500">{pokemon.currentHp}/{pokemon.card.hp}</div>
        </div>
      )}

      {/* Prize badge */}
      {isEx && (
        <div className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#EAB30833', color: '#EAB308' }}>
          {pokemon.card.prizeCards} prizes
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PLAYER BOARD
// ============================================================================

function PlayerBoard({ state, playerIdx, isFlipped }: {
  state: GameState;
  playerIdx: 0 | 1;
  isFlipped: boolean;
}) {
  const player = state.players[playerIdx];
  const isCurrentPlayer = state.currentPlayer === playerIdx;
  const borderColor = isCurrentPlayer ? 'border-yellow-500/50' : 'border-gray-700';

  const prizesFilled = player.prizeCardsRemaining;
  const prizesEmpty = 6 - prizesFilled;

  return (
    <div className={`rounded-xl border-2 ${borderColor} bg-gray-800/80 p-4 transition-all`}>
      {/* Player header */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isCurrentPlayer ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="font-bold text-white text-sm">Player {playerIdx + 1}</span>
          {isCurrentPlayer && <span className="text-[10px] text-yellow-400 uppercase">Active</span>}
        </div>
        <div className="flex gap-3 text-xs text-gray-400">
          <span>Hand: <span className="text-white font-bold">{player.hand.length}</span></span>
          <span>Deck: <span className="text-white font-bold">{player.deck.length}</span></span>
          <span>Discard: <span className="text-white font-bold">{player.discard.length}</span></span>
        </div>
      </div>

      {/* Prize cards */}
      <div className="flex gap-1 mb-3">
        <span className="text-[10px] text-gray-500 mr-1 self-center">Prizes:</span>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`w-5 h-7 rounded-sm border ${i < prizesFilled ? 'bg-yellow-500/20 border-yellow-500/40' : 'bg-gray-900 border-gray-700'}`} />
        ))}
      </div>

      {/* Board layout */}
      <div className={`flex ${isFlipped ? 'flex-col-reverse' : 'flex-col'} gap-3`}>
        {/* Active Pokemon */}
        <div className="flex justify-center">
          <PokemonDisplay pokemon={player.active} isActive={true} label="Active" />
        </div>

        {/* Bench */}
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 text-center">Bench</div>
          <div className="flex justify-center gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <PokemonDisplay key={i} pokemon={player.bench[i] || null} isActive={false} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

const App = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const [seed, setSeed] = useState(420);
  const [stateHistory, setStateHistory] = useState<GameState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const intervalRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const actionQueueRef = useRef<{ state: GameState; done: boolean }>({ state: null as any, done: false });

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameLog]);

  // Start a new game
  const startNewGame = useCallback(() => {
    const deck1 = buildCharizardDeck();
    const deck2 = buildCharizardDeck();
    const state = GameEngine.createGame(deck1, deck2, seed);
    setGameState(state);
    setGameLog([{ turn: 0, player: -1, text: `Game started (seed: ${seed})`, type: 'info' }]);
    setStateHistory([state]);
    setHistoryIndex(0);
    actionQueueRef.current = { state, done: false };
    setIsPlaying(false);
  }, [seed]);

  // Execute one simulation step (one action)
  const step = useCallback(() => {
    const ref = actionQueueRef.current;
    if (!ref.state || ref.done) return;

    let state = ref.state;

    // Draw phase -> start turn
    if (state.phase === GamePhase.DrawPhase) {
      state = GameEngine.startTurn(state);
      if (GameEngine.isGameOver(state)) {
        ref.state = state;
        ref.done = true;
        setGameState(state);
        setGameLog(prev => [...prev, {
          turn: state.turnNumber,
          player: -1,
          text: `Game Over! Player ${(GameEngine.getWinner(state) ?? 0) + 1} wins!`,
          type: 'ko',
        }]);
        setIsPlaying(false);
        return;
      }
    }

    // Play one action in current phase
    if (state.phase === GamePhase.MainPhase || state.phase === GamePhase.AttackPhase) {
      const actions = GameEngine.getLegalActions(state);
      if (actions.length > 0) {
        const action = selectAction(state, actions);
        const logEntry = describeAction(action, state);

        // Only log non-pass actions or passes that change phase
        if (action.type !== ActionType.Pass || state.phase === GamePhase.AttackPhase) {
          setGameLog(prev => [...prev, logEntry]);
        }

        state = GameEngine.applyAction(state, action);
      }
    }

    // Between turns -> end turn
    if (state.phase === GamePhase.BetweenTurns) {
      state = GameEngine.endTurn(state);
    }

    // Check for knockouts in log
    const prevState = ref.state;
    for (let p = 0; p < 2; p++) {
      if (prevState.players[p].prizeCardsRemaining > state.players[p].prizeCardsRemaining) {
        const taken = prevState.players[p].prizeCardsRemaining - state.players[p].prizeCardsRemaining;
        setGameLog(prev => [...prev, {
          turn: state.turnNumber,
          player: p,
          text: `Takes ${taken} prize card(s)! (${state.players[p].prizeCardsRemaining} remaining)`,
          type: 'ko',
        }]);
      }
    }

    // Check game over
    if (GameEngine.isGameOver(state)) {
      ref.done = true;
      setGameLog(prev => [...prev, {
        turn: state.turnNumber,
        player: -1,
        text: `Game Over! Player ${(GameEngine.getWinner(state) ?? 0) + 1} wins!`,
        type: 'ko',
      }]);
      setIsPlaying(false);
    }

    ref.state = state;
    setGameState(state);
    setStateHistory(prev => [...prev, state]);
    setHistoryIndex(prev => prev + 1);
  }, []);

  // Auto-play timer
  useEffect(() => {
    if (isPlaying) {
      const ms = Math.max(50, 1000 / speed);
      intervalRef.current = window.setInterval(step, ms);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, step]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); setIsPlaying(p => !p); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(); }
      if (e.key === 'n') { e.preventDefault(); startNewGame(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, startNewGame]);

  const winner = gameState ? GameEngine.getWinner(gameState) : null;

  // Cap log at 200 entries to prevent bloat
  const visibleLog = gameLog.slice(-200);

  return (
    <div className="fixed inset-0 bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header — fixed height */}
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-6 py-2 flex justify-between items-center h-14">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight">Pokemon TCG AI Simulator</h1>
          <p className="text-gray-400 text-[11px] truncate">
            {gameState
              ? `Turn ${gameState.turnNumber} | ${gameState.phase} | Player ${gameState.currentPlayer + 1}'s turn`
              : 'Click "New Game" to start a Charizard mirror match'}
          </p>
        </div>
        {winner !== null && (
          <div className="flex-shrink-0 bg-yellow-500/20 border border-yellow-500/50 rounded-lg px-4 py-1.5 text-yellow-400 font-bold text-sm">
            Player {winner + 1} Wins!
          </div>
        )}
      </div>

      {/* Main content — fills remaining height */}
      <div className="flex-1 flex min-h-0">
        {/* Game Board — scrolls independently */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          {gameState ? (
            <div className="flex flex-col gap-3 max-w-4xl mx-auto">
              {/* Player 2 (top, flipped) */}
              <PlayerBoard state={gameState} playerIdx={1} isFlipped={true} />

              {/* VS divider */}
              <div className="flex items-center gap-3 px-4 flex-shrink-0">
                <div className="flex-1 h-px bg-gray-700" />
                <div className="text-xs text-gray-500 font-bold px-3 py-1 rounded-full bg-gray-800 border border-gray-700 whitespace-nowrap">
                  Turn {gameState.turnNumber} &middot; {gameState.phase.replace('Phase', '')}
                </div>
                <div className="flex-1 h-px bg-gray-700" />
              </div>

              {/* Player 1 (bottom) */}
              <PlayerBoard state={gameState} playerIdx={0} isFlipped={false} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">&#127868;</div>
                <h2 className="text-2xl font-bold mb-2">Pokemon TCG AI</h2>
                <p className="text-gray-400 mb-6">Charizard ex Mirror Match Simulator</p>
                <button
                  onClick={startNewGame}
                  className="px-8 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-bold text-lg transition-colors"
                >
                  Start Game
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar — Game Log, fixed width, never collapses */}
        <div className="w-64 flex-shrink-0 bg-gray-800 border-l border-gray-700 flex flex-col min-h-0">
          <div className="flex-shrink-0 px-3 py-2 border-b border-gray-700 flex justify-between items-center">
            <h2 className="font-bold text-xs text-cyan-400">Game Log</h2>
            <span className="text-[10px] text-gray-600">{gameLog.length} events</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-2 py-1">
              {visibleLog.length === 0 ? (
                <div className="text-gray-600 text-center mt-8 text-xs">No events yet</div>
              ) : (
                visibleLog.map((entry, i) => (
                  <div key={i} className="py-0.5 text-[11px] leading-tight flex gap-1.5" style={{ borderBottom: '1px solid rgba(55,65,81,0.3)' }}>
                    <span className="text-gray-600 w-5 text-right flex-shrink-0 font-mono" style={{ fontSize: 9 }}>
                      {entry.turn > 0 ? entry.turn : ''}
                    </span>
                    <span className="min-w-0 break-words" style={{ color: LOG_COLORS[entry.type] || '#999' }}>
                      {entry.player >= 0 && <span className="font-bold">P{entry.player + 1} </span>}
                      {entry.text}
                    </span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls — fixed height */}
      <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between h-12">
        <div className="flex gap-2">
          <button
            onClick={startNewGame}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-bold transition-colors"
          >
            New Game
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={!gameState || winner !== null}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-bold disabled:opacity-40 transition-colors"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={step}
            disabled={!gameState || winner !== null}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs disabled:opacity-40 transition-colors"
          >
            Step
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-gray-400">Speed</label>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={speed}
              onChange={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
              className="w-20"
            />
            <span className="text-[10px] font-mono w-6">{speed}x</span>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-gray-400">Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
              className="w-16 bg-gray-700 rounded px-1.5 py-0.5 text-[11px] text-white border border-gray-600"
            />
          </div>

          <div className="text-[10px] text-gray-600 hidden lg:block">
            Space=play | Right=step | N=new
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
