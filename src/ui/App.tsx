import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '../engine/game-engine.js';
import { buildCharizardDeck } from '../engine/charizard-deck.js';
import { searchAction, getModels, type AIMode, type AISearchResult } from '../ai/ai-bridge.js';
import { AIDebugPanel } from './AIDebugPanel.js';
import { HandZone, DiscardZone } from './CardZone.js';
import { ActivePokemonDetail } from './ActivePokemonDetail.js';
import { EnergyStack } from './EnergyStack.js';
import { FloatingPanel } from './FloatingPanel.js';
import { JsonTreeView, getVisibleRepresentation, getDefaultExpandedPaths } from './JsonTree.js';
import type {
  GameState,
  PokemonInPlay,
  Action,
} from '../engine/types.js';
import { GamePhase, ActionType } from '../engine/types.js';

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
// BENCH POKEMON DISPLAY (with photo, ability, attacks)
// ============================================================================

function BenchCardPhoto({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src || src.includes('example.com')) {
    return (
      <div className="w-14 h-20 bg-gray-700 rounded flex items-center justify-center border border-gray-600">
        <span className="text-[7px] text-gray-400 text-center px-0.5">{name}</span>
      </div>
    );
  }
  return (
    <img src={src} alt={name} className="w-14 rounded shadow-sm" onError={() => setFailed(true)} loading="lazy" />
  );
}

function BenchPokemonDisplay({ pokemon }: { pokemon: PokemonInPlay | null }) {
  if (!pokemon) {
    return (
      <div className="w-28 flex flex-col items-center">
        <div className="w-28 h-20 bg-gray-800 rounded-lg border-2 border-dashed border-gray-700 flex items-center justify-center">
          <span className="text-gray-700 text-[8px]">Empty</span>
        </div>
      </div>
    );
  }

  const card = pokemon.card;
  const hpPct = Math.max(0, pokemon.currentHp / card.hp);
  const hpColor = hpPct > 0.5 ? '#22C55E' : hpPct > 0.25 ? '#EAB308' : '#EF4444';
  const typeColor = TYPE_COLORS[card.type] || TYPE_COLORS.Colorless;

  return (
    <div className="w-28 bg-gray-800 rounded-lg border border-gray-700">
      {/* Photo + name header */}
      <div className="flex gap-1 p-1">
        <div className="relative flex-shrink-0">
          <BenchCardPhoto src={card.imageUrl} name={card.name} />
          {pokemon.attachedEnergy.length > 0 && (
            <EnergyStack energy={pokemon.attachedEnergy} variant="bench" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[8px] text-gray-300 font-bold truncate">{card.name}</div>
          <div className="flex items-center gap-0.5 mt-px">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: typeColor }} />
            <span className="text-[7px] text-gray-500">{card.stage}</span>
          </div>
          {/* HP */}
          <div className="mt-0.5">
            <div className="w-full bg-gray-700 rounded-full h-1">
              <div className="h-1 rounded-full" style={{ width: `${hpPct * 100}%`, backgroundColor: hpColor }} />
            </div>
            <div className="text-[7px] text-gray-500">{pokemon.currentHp}/{card.hp}</div>
          </div>
          {/* Energy is now shown as stacked cards on the card image */}
        </div>
      </div>

      {/* Ability */}
      {card.ability && (
        <div className="px-1 py-0.5 border-t border-gray-700/50">
          <div className="flex items-center gap-0.5">
            <span className="text-[6px] px-0.5 rounded font-bold bg-red-900/40 text-red-400">Abl</span>
            <span className="text-[7px] text-red-300 truncate">{card.ability.name}</span>
          </div>
        </div>
      )}

      {/* Attacks (compact) */}
      <div className="px-1 py-0.5 border-t border-gray-700/50 space-y-px">
        {card.attacks.map((atk, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className="flex gap-px flex-shrink-0">
              {atk.cost.map((energyType, j) => (
                <div key={j} className="w-2 h-2 rounded-full border border-gray-600"
                  style={{ backgroundColor: TYPE_COLORS[energyType] || '#666' }} />
              ))}
            </div>
            <span className="text-[7px] text-gray-300 truncate flex-1">{atk.name}</span>
            {atk.damage > 0 && (
              <span className="text-[7px] font-bold text-red-400 flex-shrink-0">{atk.damage}</span>
            )}
          </div>
        ))}
      </div>

      {/* ex badge */}
      {card.isRulebox && (
        <div className="text-[6px] font-bold text-center py-px" style={{ backgroundColor: '#EAB30811', color: '#EAB308' }}>
          ex &middot; {card.prizeCards} prizes
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PLAYER BOARD (Active + Bench + Header)
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

  return (
    <div className={`rounded-xl border ${borderColor} bg-gray-800/80 p-3 transition-all`}>
      {/* Player header */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isCurrentPlayer ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="font-bold text-white text-xs">Player {playerIdx + 1}</span>
          {isCurrentPlayer && <span className="text-[9px] text-yellow-400 uppercase">Active</span>}
        </div>
        <div className="flex gap-2 text-[10px] text-gray-400">
          <span>Deck: <span className="text-white font-bold">{player.deck.length}</span></span>
          <span className="flex gap-0.5 items-center">
            Prizes:
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`w-3 h-4 rounded-sm border ${i < prizesFilled ? 'bg-yellow-500/20 border-yellow-500/40' : 'bg-gray-900 border-gray-700'}`} />
            ))}
          </span>
        </div>
      </div>

      {/* Board layout */}
      <div className={`flex ${isFlipped ? 'flex-col-reverse' : 'flex-col'} gap-2`}>
        {/* Active Pokemon */}
        <div className="flex justify-center">
          <ActivePokemonDetail pokemon={player.active} playerIndex={playerIdx} />
        </div>

        {/* Bench */}
        <div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 text-center">Bench</div>
          <div className="flex justify-center gap-1 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => (
              <BenchPokemonDisplay key={i} pokemon={player.bench[i] || null} />
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

  // AI state
  const [aiMode, setAiMode] = useState<AIMode>('heuristic');
  const [aiThinking, setAiThinking] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [lastSearchResult, setLastSearchResult] = useState<AISearchResult | null>(null);

  // UI state
  const [rightPanel, setRightPanel] = useState<'log' | 'ai'>('log');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugExpandedPaths, setDebugExpandedPaths] = useState<Set<string>>(() => new Set(['']));
  const [copyFeedback, setCopyFeedback] = useState<'visible' | 'full' | null>(null);
  const [showP1Hand, setShowP1Hand] = useState(true);
  const [showP2Hand, setShowP2Hand] = useState(true);
  const [showP1Discard, setShowP1Discard] = useState(false);
  const [showP2Discard, setShowP2Discard] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const actionQueueRef = useRef<{ state: GameState; done: boolean }>({ state: null as any, done: false });
  const steppingRef = useRef(false);
  const debugPanelOpenedRef = useRef(false);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameLog]);

  // Reset debug tree expansion only when panel is first opened
  useEffect(() => {
    if (!showDebugPanel) {
      debugPanelOpenedRef.current = false;
      return;
    }
    if (!debugPanelOpenedRef.current && gameState != null) {
      setDebugExpandedPaths(getDefaultExpandedPaths(gameState, 2));
      debugPanelOpenedRef.current = true;
    }
  }, [showDebugPanel, gameState]);

  const copyToClipboard = useCallback((text: string, kind: 'visible' | 'full') => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyFeedback(kind);
        setTimeout(() => setCopyFeedback(null), 1500);
      },
      () => {}
    );
  }, []);

  // Start a new game
  const startNewGame = useCallback(() => {
    const deck1 = buildCharizardDeck();
    const deck2 = buildCharizardDeck();
    const state = GameEngine.createGame(deck1, deck2, seed);
    setGameState(state);
    setGameLog([{ turn: 0, player: -1, text: `Game started (seed: ${seed})`, type: 'info' }]);
    actionQueueRef.current = { state, done: false };
    setIsPlaying(false);
    setLastSearchResult(null);
    setAiThinking(false);
    setSearchProgress(0);
  }, [seed]);

  // Execute one simulation step (one action)
  const step = useCallback(async () => {
    if (steppingRef.current) return;
    const ref = actionQueueRef.current;
    if (!ref.state || ref.done) return;

    steppingRef.current = true;

    try {
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
          let action: Action;

          if (aiMode !== 'heuristic') {
            setAiThinking(true);
            setSearchProgress(0);
            const result = await searchAction(state, actions, aiMode, (det, total) => {
              setSearchProgress(det / total);
            });
            action = result.action;
            setLastSearchResult(result);
            setAiThinking(false);
          } else {
            const result = await searchAction(state, actions, 'heuristic');
            action = result.action;
          }

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
    } finally {
      steppingRef.current = false;
    }
  }, [aiMode]);

  // Auto-play loop
  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (aiMode === 'heuristic') {
      // Heuristic: use interval for fast playback
      const ms = Math.max(50, 1000 / speed);
      intervalRef.current = window.setInterval(() => {
        step();
      }, ms);
    } else {
      // ISMCTS: sequential async loop
      let cancelled = false;
      const loop = async () => {
        while (!cancelled && isPlaying) {
          await step();
          const ref = actionQueueRef.current;
          if (ref.done) break;
          // Small delay between steps for readability
          await new Promise(resolve => setTimeout(resolve, Math.max(100, 500 / speed)));
        }
      };
      loop();
      return () => { cancelled = true; };
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, speed, step, aiMode]);

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
  const visibleLog = gameLog.slice(-200);
  const isDisabled = !gameState || winner !== null || aiThinking;

  return (
    <div className="fixed inset-0 bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-1.5 flex justify-between items-center h-12">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold leading-tight">Pokemon TCG AI Simulator</h1>
          </div>
          <p className="text-gray-400 text-[10px] truncate">
            {gameState
              ? `Turn ${gameState.turnNumber} | ${gameState.phase.replace('Phase', '')} | Player ${gameState.currentPlayer + 1}'s turn`
              : 'Click "New Game" to start a Charizard mirror match'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aiThinking && (
            <div className="text-[10px] text-yellow-400 flex items-center gap-1">
              <span className="animate-spin">&#9881;</span> AI thinking...
            </div>
          )}
          {winner !== null && (
            <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg px-3 py-1 text-yellow-400 font-bold text-xs">
              Player {winner + 1} Wins!
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Game Board */}
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {gameState ? (
            <div className="flex flex-col gap-2 max-w-4xl mx-auto">
              {/* P2 Hand */}
              <HandZone
                cards={gameState.players[1].hand}
                title={`Player 2 Hand`}
                expanded={showP2Hand}
                onToggle={() => setShowP2Hand(p => !p)}
              />

              {/* P2 Discard */}
              <DiscardZone
                cards={gameState.players[1].discard}
                title="P2 Discard"
                expanded={showP2Discard}
                onToggle={() => setShowP2Discard(p => !p)}
              />

              {/* Player 2 Board */}
              <PlayerBoard state={gameState} playerIdx={1} isFlipped={true} />

              {/* VS divider */}
              <div className="flex items-center gap-3 px-4 flex-shrink-0">
                <div className="flex-1 h-px bg-gray-700" />
                <div className="text-[10px] text-gray-500 font-bold px-3 py-0.5 rounded-full bg-gray-800 border border-gray-700 whitespace-nowrap">
                  Turn {gameState.turnNumber} &middot; {gameState.phase.replace('Phase', '')}
                </div>
                <div className="flex-1 h-px bg-gray-700" />
              </div>

              {/* Player 1 Board */}
              <PlayerBoard state={gameState} playerIdx={0} isFlipped={false} />

              {/* P1 Discard */}
              <DiscardZone
                cards={gameState.players[0].discard}
                title="P1 Discard"
                expanded={showP1Discard}
                onToggle={() => setShowP1Discard(p => !p)}
              />

              {/* P1 Hand */}
              <HandZone
                cards={gameState.players[0].hand}
                title={`Player 1 Hand`}
                expanded={showP1Hand}
                onToggle={() => setShowP1Hand(p => !p)}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Outer ring */}
                    <circle cx="48" cy="48" r="44" stroke="#e53e3e" strokeWidth="4" fill="none" />
                    {/* Top half - red */}
                    <path d="M4 48 A44 44 0 0 1 92 48" fill="#e53e3e" />
                    {/* Bottom half - white */}
                    <path d="M4 48 A44 44 0 0 0 92 48" fill="#f7fafc" />
                    {/* Center band */}
                    <rect x="4" y="45" width="88" height="6" fill="#2d3748" />
                    {/* Center button outer */}
                    <circle cx="48" cy="48" r="14" fill="#2d3748" />
                    {/* Center button inner - AI glow */}
                    <circle cx="48" cy="48" r="10" fill="#1a202c">
                      <animate attributeName="fill" values="#1a202c;#2b6cb0;#1a202c" dur="3s" repeatCount="indefinite" />
                    </circle>
                    {/* AI circuit lines inside button */}
                    <circle cx="48" cy="48" r="4" fill="#63b3ed">
                      <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <line x1="48" y1="40" x2="48" y2="44" stroke="#63b3ed" strokeWidth="1.5" strokeLinecap="round">
                      <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="0.2s" repeatCount="indefinite" />
                    </line>
                    <line x1="48" y1="52" x2="48" y2="56" stroke="#63b3ed" strokeWidth="1.5" strokeLinecap="round">
                      <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="0.4s" repeatCount="indefinite" />
                    </line>
                    <line x1="40" y1="48" x2="44" y2="48" stroke="#63b3ed" strokeWidth="1.5" strokeLinecap="round">
                      <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="0.6s" repeatCount="indefinite" />
                    </line>
                    <line x1="52" y1="48" x2="56" y2="48" stroke="#63b3ed" strokeWidth="1.5" strokeLinecap="round">
                      <animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="0.8s" repeatCount="indefinite" />
                    </line>
                    {/* Diagonal circuit traces */}
                    <line x1="42" y1="42" x2="44.5" y2="44.5" stroke="#63b3ed" strokeWidth="1" strokeLinecap="round">
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.5s" begin="0.3s" repeatCount="indefinite" />
                    </line>
                    <line x1="54" y1="42" x2="51.5" y2="44.5" stroke="#63b3ed" strokeWidth="1" strokeLinecap="round">
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.5s" begin="0.5s" repeatCount="indefinite" />
                    </line>
                    <line x1="42" y1="54" x2="44.5" y2="51.5" stroke="#63b3ed" strokeWidth="1" strokeLinecap="round">
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.5s" begin="0.7s" repeatCount="indefinite" />
                    </line>
                    <line x1="54" y1="54" x2="51.5" y2="51.5" stroke="#63b3ed" strokeWidth="1" strokeLinecap="round">
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.5s" begin="0.9s" repeatCount="indefinite" />
                    </line>
                    {/* Outer glow ring */}
                    <circle cx="48" cy="48" r="46" stroke="#63b3ed" strokeWidth="1" fill="none" opacity="0.3">
                      <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="r" values="46;47;46" dur="3s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                </div>
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

        {/* Right Sidebar — tabbed (Log / AI) */}
        <div className="w-72 flex-shrink-0 bg-gray-800 border-l border-gray-700 flex flex-col min-h-0">
          {/* Tab bar */}
          <div className="flex-shrink-0 flex border-b border-gray-700">
            <button
              className={`flex-1 px-2 py-1.5 text-xs font-bold transition-colors ${rightPanel === 'log' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
              onClick={() => setRightPanel('log')}
            >
              Log <span className="text-[9px] font-normal text-gray-600">({gameLog.length})</span>
            </button>
            <button
              className={`flex-1 px-2 py-1.5 text-xs font-bold transition-colors ${rightPanel === 'ai' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-500 hover:text-gray-300'}`}
              onClick={() => setRightPanel('ai')}
            >
              AI
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {rightPanel === 'log' ? (
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
            ) : (
              <AIDebugPanel
                searchResult={lastSearchResult}
                isSearching={aiThinking}
                searchProgress={searchProgress}
                aiMode={aiMode}
                gameState={gameState}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 px-4 py-1.5 flex items-center justify-between h-11">
        <div className="flex gap-1.5">
          <button
            onClick={startNewGame}
            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 rounded text-[10px] font-bold transition-colors"
          >
            New Game
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={isDisabled}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 rounded text-[10px] font-bold disabled:opacity-40 transition-colors"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={() => step()}
            disabled={isDisabled}
            className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] disabled:opacity-40 transition-colors"
          >
            Step
          </button>
        </div>

        {/* AI Mode selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400 font-bold mr-0.5">AI Model:</span>
          {getModels().map(model => (
            <button
              key={model.id}
              onClick={() => setAiMode(model.id)}
              title={model.description}
              className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${aiMode === model.id
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50 ring-1 ring-purple-400/30'
                : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
            >
              {model.name}
              {model.ismctsConfig && (
                <span className="ml-1 text-[8px] opacity-60">
                  {model.ismctsConfig.determinizations}×{model.ismctsConfig.simulations}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <label className="text-[9px] text-gray-500">Speed</label>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={speed}
              onChange={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
              className="w-16"
            />
            <span className="text-[9px] font-mono w-5">{speed}x</span>
          </div>

          <div className="flex items-center gap-1">
            <label className="text-[9px] text-gray-500">Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
              className="w-14 bg-gray-700 rounded px-1 py-0.5 text-[10px] text-white border border-gray-600"
            />
          </div>

          <div className="text-[9px] text-gray-600 hidden xl:block">
            Space=play | &#8594;=step | N=new
          </div>

          <button
            onClick={() => setShowDebugPanel((p) => !p)}
            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${showDebugPanel ? 'bg-amber-600 text-white ring-1 ring-amber-400/50' : 'bg-gray-700 text-gray-400 hover:text-amber-400 hover:bg-gray-600'}`}
            title="Toggle state debugger"
          >
            Debug
          </button>
        </div>
      </div>

      {/* Floating state debugger */}
      {showDebugPanel && (
        <FloatingPanel
          title="Game state (PlayerBoard)"
          onClose={() => setShowDebugPanel(false)}
          defaultPosition={{ x: 24, y: 60 }}
          defaultSize={{ width: 400, height: 420 }}
        >
          {gameState == null ? (
            <div className="p-4 text-gray-500 text-sm">No game — start a game to see state.</div>
          ) : (
            <>
              <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-gray-700 bg-gray-800/80">
                <button
                  type="button"
                  onClick={() => {
                    const visible = getVisibleRepresentation(gameState, debugExpandedPaths);
                    copyToClipboard(JSON.stringify(visible, null, 2), 'visible');
                  }}
                  className="px-2.5 py-1 rounded text-[10px] font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                  title="Copy only the currently expanded nodes as JSON"
                >
                  Copy visible
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(JSON.stringify(gameState, null, 2), 'full')}
                  className="px-2.5 py-1 rounded text-[10px] font-bold bg-gray-600 hover:bg-gray-500 text-white transition-colors"
                  title="Copy full game state as JSON"
                >
                  Copy full
                </button>
                {copyFeedback && (
                  <span className="text-[10px] text-green-400 font-medium">
                    Copied {copyFeedback}!
                  </span>
                )}
              </div>
              <JsonTreeView
                data={gameState}
                defaultExpandedDepth={2}
                expandedPaths={debugExpandedPaths}
                onTogglePath={(path) => {
                  setDebugExpandedPaths((prev) => {
                    const next = new Set(prev);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  });
                }}
              />
            </>
          )}
        </FloatingPanel>
      )}
    </div>
  );
};

export default App;
