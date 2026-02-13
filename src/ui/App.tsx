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
  Card,
} from '../engine/types.js';
import { GamePhase, ActionType } from '../engine/types.js';

// ============================================================================
// TYPES
// ============================================================================

type LogType = 'attack' | 'play' | 'energy' | 'trainer' | 'ko' | 'pass' | 'info' | 'ability' | 'retreat' | 'turn' | 'draw' | 'evolve' | 'knockout';

interface GameLogEntry {
  turn: number;
  player: number;
  text: string;
  type: LogType;
  /** Index into historyRef for jumping to this state */
  snapshotIndex?: number;
}

interface HistorySnapshot {
  state: GameState;
  log: GameLogEntry[];
}

interface ActionCallout {
  card: Card | null;
  text: string;
  type: LogType;
  player: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function describeAction(action: Action, state: GameState): GameLogEntry {
  const player = action.player;
  const turn = state.turnNumber;
  const pState = state.players[player];

  switch (action.type) {
    case ActionType.Attack: {
      const active = pState.active;
      const atk = active?.card.attacks[action.payload.attackIndex];
      return { turn, player, text: `${active?.card.name} uses ${atk?.name}${atk?.damage ? ` (${atk.damage} dmg)` : ''}`, type: 'attack' };
    }
    case ActionType.PlayPokemon: {
      const card = pState.hand[action.payload.handIndex];
      const isEvolution = action.payload.targetZone != null;
      if (isEvolution) {
        const targetName = action.payload.targetZone === 'active'
          ? pState.active?.card.name
          : pState.bench[action.payload.benchIndex]?.card.name;
        return { turn, player, text: `Evolves ${targetName || '???'} into ${card?.name || '???'}`, type: 'evolve' };
      }
      return { turn, player, text: `Plays ${card?.name || '???'} to bench`, type: 'play' };
    }
    case ActionType.AttachEnergy: {
      const energyCard = pState.hand[action.payload.handIndex];
      const targetPokemon = action.payload.target === 'active'
        ? pState.active?.card.name
        : pState.bench[action.payload.benchIndex]?.card.name;
      return { turn, player, text: `Attaches energy to ${targetPokemon || action.payload.target}`, type: 'energy' };
    }
    case ActionType.PlayTrainer: {
      const card = pState.hand[action.payload.handIndex];
      return { turn, player, text: `Plays ${card?.name || '???'}`, type: 'trainer' };
    }
    case ActionType.Retreat: {
      const from = pState.active?.card.name || '???';
      const to = pState.bench[action.payload.benchIndex]?.card.name || '???';
      return { turn, player, text: `Retreats ${from}, sends in ${to}`, type: 'retreat' };
    }
    case ActionType.UseAbility: {
      const zone = action.payload.zone as string;
      const abilityName = action.payload.abilityName as string;
      let pokemonName = '???';
      if (zone === 'active') {
        pokemonName = pState.active?.card.name || '???';
      } else if (zone === 'bench') {
        pokemonName = pState.bench[action.payload.benchIndex]?.card.name || '???';
      }
      return { turn, player, text: `${pokemonName}'s ${abilityName}`, type: 'ability' };
    }
    case ActionType.Pass:
      return { turn, player, text: 'End turn', type: 'pass' };
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
  knockout: '#F97316',
  pass: '#6B7280',
  info: '#9CA3AF',
  ability: '#A78BFA',
  retreat: '#60A5FA',
  turn: '#475569',
  draw: '#94A3B8',
  evolve: '#34D399',
};

const LOG_ICONS: Record<string, string> = {
  attack: '\u2694\uFE0F',    // crossed swords
  play: '\u{1F0CF}',         // playing card
  energy: '\u26A1',           // lightning bolt
  trainer: '\u{1F4DC}',      // scroll
  ko: '\u{1F4A5}',           // explosion
  knockout: '\u{1F4A5}',     // explosion
  pass: '\u23ED\uFE0F',      // skip forward
  info: '\u2139\uFE0F',      // info
  ability: '\u2728',          // sparkles
  retreat: '\u{1F504}',      // arrows cycle
  turn: '\u{1F501}',         // repeat
  draw: '\u{1F0CF}',         // playing card
  evolve: '\u2B06\uFE0F',    // up arrow
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

  // History / navigation state
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [activeCallout, setActiveCallout] = useState<ActionCallout | null>(null);

  const intervalRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const actionQueueRef = useRef<{ state: GameState; done: boolean }>({ state: null as any, done: false });
  const steppingRef = useRef(false);
  const debugPanelOpenedRef = useRef(false);
  const historyRef = useRef<HistorySnapshot[]>([]);
  const logRef = useRef<GameLogEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const calloutTimerRef = useRef<number | null>(null);

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
    const initialLog: GameLogEntry[] = [{ turn: 0, player: -1, text: `Game started (seed: ${seed})`, type: 'info' }];
    setGameState(state);
    setGameLog(initialLog);
    logRef.current = initialLog;
    historyRef.current = [{ state, log: initialLog }];
    historyIndexRef.current = 0;
    setHistoryIndex(0);
    actionQueueRef.current = { state, done: false };
    setIsPlaying(false);
    setLastSearchResult(null);
    setAiThinking(false);
    setSearchProgress(0);
    setActiveCallout(null);
  }, [seed]);

  // Extract the relevant card from an action for the callout display
  const getCardForAction = useCallback((action: Action, state: GameState): Card | null => {
    const pState = state.players[action.player];
    switch (action.type) {
      case ActionType.PlayPokemon:
      case ActionType.PlayTrainer:
      case ActionType.AttachEnergy:
        return pState.hand[action.payload.handIndex] || null;
      case ActionType.Attack:
        return pState.active?.card || null;
      case ActionType.UseAbility: {
        if (action.payload.zone === 'active') return pState.active?.card || null;
        if (action.payload.zone === 'bench') return pState.bench[action.payload.benchIndex]?.card || null;
        return null;
      }
      case ActionType.Retreat:
        return pState.active?.card || null;
      default:
        return null;
    }
  }, []);

  // Show an action callout with card image
  const showCallout = useCallback((callout: ActionCallout) => {
    if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current);
    setActiveCallout(callout);
    calloutTimerRef.current = window.setTimeout(() => {
      setActiveCallout(null);
      calloutTimerRef.current = null;
    }, Math.max(800, 2500 / speed));
  }, [speed]);

  // Execute one simulation step (one action)
  const step = useCallback(async () => {
    if (steppingRef.current) return;
    const ref = actionQueueRef.current;
    if (!ref.state || ref.done) return;

    steppingRef.current = true;

    try {
      let state = ref.state;
      const newLogEntries: GameLogEntry[] = [];

      // Draw phase -> start turn (add turn separator)
      if (state.phase === GamePhase.DrawPhase) {
        state = GameEngine.startTurn(state);

        // Add a turn separator header
        newLogEntries.push({
          turn: state.turnNumber,
          player: state.currentPlayer,
          text: `Turn ${state.turnNumber}`,
          type: 'turn',
        });

        // Log the draw
        newLogEntries.push({
          turn: state.turnNumber,
          player: state.currentPlayer,
          text: 'Draws a card',
          type: 'draw',
        });

        if (GameEngine.isGameOver(state)) {
          ref.state = state;
          ref.done = true;
          setGameState(state);
          newLogEntries.push({
            turn: state.turnNumber,
            player: -1,
            text: `Game Over! Player ${(GameEngine.getWinner(state) ?? 0) + 1} wins!`,
            type: 'ko',
          });
          const earlySnapIdx = historyRef.current.length;
          for (const entry of newLogEntries) { entry.snapshotIndex = earlySnapIdx; }
          logRef.current = [...logRef.current, ...newLogEntries];
          setGameLog(logRef.current);
          historyRef.current.push({ state, log: logRef.current });
          historyIndexRef.current = historyRef.current.length - 1;
          setHistoryIndex(historyIndexRef.current);
          setIsPlaying(false);
          return;
        }
      }

      // Play one action in current phase
      let actionCallout: ActionCallout | null = null;
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

          // Only log meaningful actions — skip Pass (unless end of turn), ChooseCard, and SelectTarget
          // ChooseCard/SelectTarget are internal sub-actions whose results are already logged by the engine
          if (action.type !== ActionType.Pass || state.phase === GamePhase.AttackPhase) {
            if (action.type !== ActionType.ChooseCard && action.type !== ActionType.SelectTarget) {
              newLogEntries.push(logEntry);
            }
          }

          // Extract card for callout (skip internal sub-actions)
          if (action.type !== ActionType.Pass && action.type !== ActionType.ChooseCard && action.type !== ActionType.SelectTarget) {
            const card = getCardForAction(action, state);
            actionCallout = { card, text: logEntry.text, type: logEntry.type, player: action.player };
          }

          const prevLogLen = state.gameLog.length;
          state = GameEngine.applyAction(state, action);

          // Capture any new engine log messages (abilities triggering, search results, etc.)
          if (state.gameLog.length > prevLogLen) {
            for (let li = prevLogLen; li < state.gameLog.length; li++) {
              const msg = state.gameLog[li];
              // Skip messages we already represent via describeAction
              if (msg.includes('places ') || msg.includes('attaches ') || msg.includes('draws a card')) continue;
              if (msg.startsWith('Player') && msg.includes('plays ')) continue;  // "Player X plays TrainerName."
              if (msg.startsWith('Player') && msg.includes('uses ') && !msg.includes('activates')) continue;  // "Player X uses Attack for Y damage."

              // Categorize the message
              if (msg.includes('activates')) {
                newLogEntries.push({ turn: state.turnNumber, player: state.currentPlayer, text: msg, type: 'ability' });
              } else if (msg.includes('knocked out')) {
                newLogEntries.push({ turn: state.turnNumber, player: state.currentPlayer, text: msg, type: 'knockout' });
              } else if (msg.includes('evolves')) {
                newLogEntries.push({ turn: state.turnNumber, player: state.currentPlayer, text: msg, type: 'evolve' });
              } else if (msg.includes('Searched') || msg.includes('searched for') || msg.includes('discarded')) {
                newLogEntries.push({ turn: state.turnNumber, player: state.currentPlayer, text: msg, type: 'trainer' });
              } else if (msg.includes('Switched')) {
                newLogEntries.push({ turn: state.turnNumber, player: state.currentPlayer, text: msg, type: 'retreat' });
              } else {
                newLogEntries.push({ turn: state.turnNumber, player: state.currentPlayer, text: msg, type: 'info' });
              }
            }
          }
        }
      }

      // Between turns -> end turn
      if (state.phase === GamePhase.BetweenTurns) {
        state = GameEngine.endTurn(state);
      }

      // Check for knockouts by comparing prize cards
      const prevState = ref.state;
      for (let p = 0; p < 2; p++) {
        if (prevState.players[p].prizeCardsRemaining > state.players[p].prizeCardsRemaining) {
          const taken = prevState.players[p].prizeCardsRemaining - state.players[p].prizeCardsRemaining;
          // Find which opponent Pokemon got KO'd
          const opp = 1 - p;
          let koName = '';
          if (prevState.players[opp].active && !state.players[opp].active) {
            koName = prevState.players[opp].active!.card.name;
          } else {
            const prevBenchNames = prevState.players[opp].bench.map(b => b.card.name);
            const currBenchNames = state.players[opp].bench.map(b => b.card.name);
            for (const name of prevBenchNames) {
              const idx = currBenchNames.indexOf(name);
              if (idx === -1) { koName = name; break; }
              currBenchNames.splice(idx, 1);
            }
          }
          newLogEntries.push({
            turn: state.turnNumber,
            player: p,
            text: koName
              ? `KO'd ${koName}! Takes ${taken} prize(s) (${state.players[p].prizeCardsRemaining} left)`
              : `Takes ${taken} prize(s)! (${state.players[p].prizeCardsRemaining} left)`,
            type: 'knockout',
          });
        }
      }

      // Check game over
      if (GameEngine.isGameOver(state)) {
        ref.done = true;
        const winner = GameEngine.getWinner(state) ?? 0;
        newLogEntries.push({
          turn: state.turnNumber,
          player: -1,
          text: `Game Over! Player ${winner + 1} wins!`,
          type: 'ko',
        });
        setIsPlaying(false);
      }

      // Tag all new log entries with the snapshot index they belong to
      const nextSnapshotIdx = historyRef.current.length;
      for (const entry of newLogEntries) {
        entry.snapshotIndex = nextSnapshotIdx;
      }

      // Update log synchronously via ref, then push snapshot
      if (newLogEntries.length > 0) {
        logRef.current = [...logRef.current, ...newLogEntries];
        setGameLog(logRef.current);
      }

      ref.state = state;
      setGameState(state);

      // Push to history
      historyRef.current.push({ state, log: logRef.current });
      historyIndexRef.current = historyRef.current.length - 1;
      setHistoryIndex(historyIndexRef.current);

      // Show action callout
      if (actionCallout) {
        showCallout(actionCallout);
      }
    } finally {
      steppingRef.current = false;
    }
  }, [aiMode, getCardForAction, showCallout]);

  // ---- Navigation functions ----

  const restoreSnapshot = useCallback((index: number) => {
    const snapshot = historyRef.current[index];
    if (!snapshot) return;
    setHistoryIndex(index);
    historyIndexRef.current = index;
    setGameState(snapshot.state);
    setGameLog(snapshot.log);
    logRef.current = snapshot.log;
    actionQueueRef.current.state = snapshot.state;
    actionQueueRef.current.done = snapshot.state.winner !== null;

    // Show callout for the last meaningful action at this snapshot
    const log = snapshot.log;
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      if (entry.type !== 'turn' && entry.type !== 'draw' && entry.type !== 'info' && entry.type !== 'pass') {
        // Try to find the card from the current state
        const pState = entry.player >= 0 ? snapshot.state.players[entry.player] : null;
        const card = pState?.active?.card || null;
        showCallout({ card, text: entry.text, type: entry.type, player: entry.player });
        break;
      }
    }
  }, [showCallout]);

  const stepBack = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    setIsPlaying(false);
    restoreSnapshot(historyIndexRef.current - 1);
  }, [restoreSnapshot]);

  const stepForward = useCallback(async () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      // Restore next snapshot from history (no AI needed)
      restoreSnapshot(historyIndexRef.current + 1);
    } else {
      // At end of history — generate new step
      await step();
    }
  }, [restoreSnapshot, step]);

  const skipToPlayerTurn = useCallback(async (direction: 'back' | 'forward') => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx < 0 || !hist[idx]) return;
    const currentPlayer = hist[idx].state.currentPlayer;

    if (direction === 'back') {
      setIsPlaying(false);
      // Search backward for where currentPlayer differs
      for (let i = idx - 1; i >= 0; i--) {
        if (hist[i].state.currentPlayer !== currentPlayer || hist[i].state.turnNumber !== hist[idx].state.turnNumber) {
          // Found different player — find start of that player's turn
          const targetPlayer = hist[i].state.currentPlayer;
          const targetTurn = hist[i].state.turnNumber;
          let startIdx = i;
          while (startIdx > 0 &&
                 hist[startIdx - 1].state.currentPlayer === targetPlayer &&
                 hist[startIdx - 1].state.turnNumber === targetTurn) {
            startIdx--;
          }
          restoreSnapshot(startIdx);
          return;
        }
      }
      restoreSnapshot(0);
    } else {
      // Forward: search for next player turn change in existing history
      for (let i = idx + 1; i < hist.length; i++) {
        if (hist[i].state.currentPlayer !== currentPlayer) {
          restoreSnapshot(i);
          return;
        }
      }
      // Not in history — step forward until player changes
      if (actionQueueRef.current.done) return;
      setIsPlaying(false);
      // Jump to latest first if viewing past
      if (historyIndexRef.current < hist.length - 1) {
        restoreSnapshot(hist.length - 1);
      }
      const startPlayer = actionQueueRef.current.state.currentPlayer;
      let guard = 0;
      while (!actionQueueRef.current.done && guard++ < 200) {
        await step();
        if (actionQueueRef.current.state.currentPlayer !== startPlayer) break;
      }
    }
  }, [restoreSnapshot, step]);

  const skipToFullTurn = useCallback(async (direction: 'back' | 'forward') => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx < 0 || !hist[idx]) return;
    const currentTurn = hist[idx].state.turnNumber;

    if (direction === 'back') {
      setIsPlaying(false);
      // Find previous turn number
      for (let i = idx - 1; i >= 0; i--) {
        if (hist[i].state.turnNumber < currentTurn) {
          const targetTurn = hist[i].state.turnNumber;
          let startIdx = i;
          while (startIdx > 0 && hist[startIdx - 1].state.turnNumber === targetTurn) {
            startIdx--;
          }
          restoreSnapshot(startIdx);
          return;
        }
      }
      restoreSnapshot(0);
    } else {
      // Forward: find next turn number change in existing history
      for (let i = idx + 1; i < hist.length; i++) {
        if (hist[i].state.turnNumber > currentTurn) {
          restoreSnapshot(i);
          return;
        }
      }
      // Not in history — step forward until turn changes
      if (actionQueueRef.current.done) return;
      setIsPlaying(false);
      if (historyIndexRef.current < hist.length - 1) {
        restoreSnapshot(hist.length - 1);
      }
      const startTurn = actionQueueRef.current.state.turnNumber;
      let guard = 0;
      while (!actionQueueRef.current.done && guard++ < 200) {
        await step();
        if (actionQueueRef.current.state.turnNumber > startTurn) break;
      }
    }
  }, [restoreSnapshot, step]);

  const togglePlay = useCallback(() => {
    if (!isPlaying) {
      // If viewing past, jump to latest first
      if (historyIndexRef.current < historyRef.current.length - 1) {
        restoreSnapshot(historyRef.current.length - 1);
      }
    }
    setIsPlaying(p => !p);
  }, [isPlaying, restoreSnapshot]);

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
      // Ignore when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      if (e.key === 'n') { e.preventDefault(); startNewGame(); }

      const hasCtrl = e.ctrlKey || e.metaKey;
      const hasShift = e.shiftKey;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (hasCtrl) { skipToFullTurn('forward'); }
        else if (hasShift) { skipToPlayerTurn('forward'); }
        else { stepForward(); }
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (hasCtrl) { skipToFullTurn('back'); }
        else if (hasShift) { skipToPlayerTurn('back'); }
        else { stepBack(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stepForward, stepBack, skipToPlayerTurn, skipToFullTurn, togglePlay, startNewGame]);

  const winner = gameState ? GameEngine.getWinner(gameState) : null;
  const visibleLog = gameLog.slice(-200);
  const isDisabled = !gameState || winner !== null || aiThinking;
  const canGoBack = historyIndex > 0;
  const canGoForwardInHistory = historyIndex >= 0 && historyIndex < historyRef.current.length - 1;
  const isViewingPast = canGoForwardInHistory;

  return (
    <div className="fixed inset-0 bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Callout animation */}
      <style>{`
        @keyframes callout-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

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
        <div className="flex-1 min-w-0 overflow-y-auto p-3 relative">
          {/* Viewing past indicator */}
          {isViewingPast && (
            <div className="absolute top-3 right-3 z-40 bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-3 py-1.5 pointer-events-none">
              <span className="text-[10px] font-bold text-yellow-400">Viewing history ({historyIndex + 1}/{historyRef.current.length})</span>
            </div>
          )}

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

              {/* VS divider + Stadium */}
              <div className="flex items-center gap-3 px-4 flex-shrink-0">
                <div className="flex-1 h-px bg-gray-700" />

                {/* Stadium card display */}
                {gameState.stadium ? (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-gray-800 border border-emerald-700/40">
                    {gameState.stadium.imageUrl && !gameState.stadium.imageUrl.includes('example.com') ? (
                      <img src={gameState.stadium.imageUrl} alt={gameState.stadium.name} className="w-8 h-auto rounded" loading="lazy" />
                    ) : (
                      <div className="w-8 h-11 bg-gray-700 rounded flex items-center justify-center">
                        <span className="text-[6px] text-gray-400">{gameState.stadium.name}</span>
                      </div>
                    )}
                    <div>
                      <div className="text-[9px] text-emerald-400 font-bold">{gameState.stadium.name}</div>
                      <div className="text-[8px] text-gray-500">Stadium</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-500 font-bold px-3 py-0.5 rounded-full bg-gray-800 border border-gray-700 whitespace-nowrap">
                    Turn {gameState.turnNumber} &middot; {gameState.phase.replace('Phase', '')}
                  </div>
                )}

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
          {/* Action Event Callout — pinned at top */}
          {activeCallout && (
            <div className="flex-shrink-0 border-b border-gray-700 px-3 py-2.5"
              style={{
                borderLeftWidth: 3,
                borderLeftStyle: 'solid',
                borderLeftColor: activeCallout.player === 0 ? '#3B82F6' : activeCallout.player === 1 ? '#EF4444' : '#6B7280',
                background: 'rgba(17,24,39,0.8)',
                animation: 'callout-in 0.15s ease-out',
              }}>
              <div className="flex gap-2.5 items-start">
                {activeCallout.card && activeCallout.card.imageUrl && !activeCallout.card.imageUrl.includes('example.com') ? (
                  <img src={activeCallout.card.imageUrl} alt="" className="w-12 h-auto rounded-lg shadow-md flex-shrink-0" loading="eager" />
                ) : activeCallout.card ? (
                  <div className="w-12 h-[68px] bg-gray-700 rounded-lg flex items-center justify-center border border-gray-600 flex-shrink-0">
                    <span className="text-[6px] text-gray-400 text-center px-0.5">{activeCallout.card.name}</span>
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold mb-0.5" style={{ color: activeCallout.player === 0 ? '#60A5FA' : activeCallout.player === 1 ? '#F87171' : '#9CA3AF' }}>
                    {activeCallout.player >= 0 ? `Player ${activeCallout.player + 1}` : ''}
                  </div>
                  <div className="text-[12px] font-bold flex items-center gap-1.5 leading-tight" style={{ color: LOG_COLORS[activeCallout.type] || '#999' }}>
                    <span className="text-sm flex-shrink-0">{LOG_ICONS[activeCallout.type] || ''}</span>
                    <span className="break-words">{activeCallout.text}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

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
                  visibleLog.map((entry, i) => {
                    const isClickable = entry.snapshotIndex != null && entry.snapshotIndex < historyRef.current.length;
                    const isActive = entry.snapshotIndex != null && entry.snapshotIndex === historyIndex;
                    const handleClick = isClickable ? () => {
                      setIsPlaying(false);
                      restoreSnapshot(entry.snapshotIndex!);
                    } : undefined;

                    // Turn separator — big banner
                    if (entry.type === 'turn') {
                      return (
                        <div key={i}
                          onClick={handleClick}
                          className={`flex items-center gap-2 py-1.5 mt-1 mb-0.5 ${isClickable ? 'cursor-pointer hover:bg-gray-700/40' : ''} ${isActive ? 'bg-cyan-900/20 rounded' : ''}`}
                          style={{ borderTop: i > 0 ? '2px solid rgba(71,85,105,0.5)' : 'none' }}>
                          <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: entry.player === 0 ? '#3B82F6' : '#EF4444', color: '#fff' }}>
                            {entry.player >= 0 ? entry.player + 1 : '?'}
                          </div>
                          <span className="text-xs font-black tracking-wide" style={{ color: entry.player === 0 ? '#60A5FA' : '#F87171' }}>
                            {entry.text}
                          </span>
                          <div className="flex-1 h-px" style={{ background: 'rgba(71,85,105,0.4)' }} />
                          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />}
                        </div>
                      );
                    }

                    // Knockout / game over — highlighted
                    if (entry.type === 'knockout' || entry.type === 'ko') {
                      return (
                        <div key={i}
                          onClick={handleClick}
                          className={`py-1 px-1.5 my-0.5 rounded text-[11px] leading-tight flex gap-1.5 items-start ${isClickable ? 'cursor-pointer hover:brightness-125' : ''}`}
                          style={{ background: isActive ? 'rgba(249,115,22,0.22)' : 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)' }}>
                          <span className="flex-shrink-0" style={{ fontSize: 13 }}>{LOG_ICONS[entry.type] || ''}</span>
                          <span className="min-w-0 break-words font-bold flex-1" style={{ color: LOG_COLORS[entry.type] || '#F97316' }}>
                            {entry.player >= 0 && <span style={{ color: entry.player === 0 ? '#60A5FA' : '#F87171' }}>P{entry.player + 1} </span>}
                            {entry.text}
                          </span>
                          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0 mt-1" />}
                        </div>
                      );
                    }

                    // Normal log entries with icon
                    return (
                      <div key={i}
                        onClick={handleClick}
                        className={`py-0.5 text-[11px] leading-tight flex gap-1 items-start ${isClickable ? 'cursor-pointer hover:bg-gray-700/30' : ''} ${isActive ? 'bg-cyan-900/20 rounded px-0.5' : ''}`}
                        style={{ borderBottom: '1px solid rgba(55,65,81,0.15)' }}>
                        <span className="flex-shrink-0 w-4 text-center" style={{ fontSize: 10 }}>
                          {LOG_ICONS[entry.type] || ''}
                        </span>
                        <span className="min-w-0 break-words flex-1" style={{ color: LOG_COLORS[entry.type] || '#999' }}>
                          {entry.player >= 0 && <span className="font-bold" style={{ color: entry.player === 0 ? '#60A5FA' : '#F87171' }}>P{entry.player + 1} </span>}
                          {entry.text}
                        </span>
                        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0 mt-1" />}
                      </div>
                    );
                  })
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
      <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 px-3 py-1.5 flex items-center gap-2 h-11">
        {/* Game controls */}
        <div className="flex gap-1">
          <button
            onClick={startNewGame}
            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 rounded text-[10px] font-bold transition-colors"
            title="New Game (N)"
          >
            New
          </button>
          <button
            onClick={togglePlay}
            disabled={isDisabled && !isViewingPast}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 rounded text-[10px] font-bold disabled:opacity-40 transition-colors"
            title="Play / Pause (Space)"
          >
            {isPlaying ? '\u23F8' : '\u25B6'}
          </button>
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-0.5 border-l border-gray-600 pl-2">
          <button
            onClick={() => skipToFullTurn('back')}
            disabled={!canGoBack}
            className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold disabled:opacity-30 transition-colors"
            title="Previous full turn (Ctrl+Left)"
          >
            {'\u23EE'}
          </button>
          <button
            onClick={() => skipToPlayerTurn('back')}
            disabled={!canGoBack}
            className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold disabled:opacity-30 transition-colors"
            title="Previous player turn (Shift+Left)"
          >
            {'\u23EA'}
          </button>
          <button
            onClick={stepBack}
            disabled={!canGoBack}
            className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold disabled:opacity-30 transition-colors"
            title="Step back (Left)"
          >
            {'\u25C0'}
          </button>
          <button
            onClick={stepForward}
            disabled={isDisabled && !canGoForwardInHistory}
            className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold disabled:opacity-30 transition-colors"
            title="Step forward (Right)"
          >
            {'\u25B6'}
          </button>
          <button
            onClick={() => skipToPlayerTurn('forward')}
            disabled={isDisabled && !canGoForwardInHistory}
            className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold disabled:opacity-30 transition-colors"
            title="Next player turn (Shift+Right)"
          >
            {'\u23E9'}
          </button>
          <button
            onClick={() => skipToFullTurn('forward')}
            disabled={isDisabled && !canGoForwardInHistory}
            className="px-1.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] font-bold disabled:opacity-30 transition-colors"
            title="Next full turn (Ctrl+Right)"
          >
            {'\u23ED'}
          </button>
        </div>

        {/* History position */}
        {historyRef.current.length > 1 && (
          <span className="text-[9px] text-gray-500 font-mono tabular-nums">
            {historyIndex + 1}/{historyRef.current.length}
            {isViewingPast && <span className="text-yellow-400 ml-1">past</span>}
          </span>
        )}

        {/* AI Mode selector */}
        <div className="flex items-center gap-1 ml-auto border-l border-gray-600 pl-2">
          <span className="text-[10px] text-gray-400 font-bold mr-0.5">AI:</span>
          {getModels().map(model => (
            <button
              key={model.id}
              onClick={() => setAiMode(model.id)}
              title={model.description}
              className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${aiMode === model.id
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

        {/* Speed / Seed / Hotkeys / Debug */}
        <div className="flex items-center gap-2 border-l border-gray-600 pl-2">
          <div className="flex items-center gap-1">
            <label className="text-[9px] text-gray-500">Spd</label>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={speed}
              onChange={(e) => setSpeed(parseInt((e.target as HTMLInputElement).value, 10))}
              className="w-12"
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

          <div className="text-[8px] text-gray-600 hidden 2xl:block leading-tight">
            <span>&#8592;/&#8594;=step &middot; Shift=player &middot; Ctrl=turn</span>
          </div>

          <button
            onClick={() => setShowDebugPanel((p) => !p)}
            className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${showDebugPanel ? 'bg-amber-600 text-white ring-1 ring-amber-400/50' : 'bg-gray-700 text-gray-400 hover:text-amber-400 hover:bg-gray-600'}`}
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
