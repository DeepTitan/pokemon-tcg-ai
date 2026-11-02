import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerField } from '../TrackerApp.js';
import { ReviewOverlay, type ReviewInspector } from '../ReviewInteractions.js';
import { cardInfoToEngineCard, cardSourceIdFromReviewCard, hiddenReviewCard } from '../card-adapter.js';
import { deriveReviewPrizeKnowledge } from '../review-prize-knowledge.js';
import fixture from './fixtures/captured-decklist.json';
import type { Card, PlayerState, PokemonInPlay } from '../../engine/types.js';
import type { CardInfo, TrackedPlayerBoard, ReviewCardVisibility, CapturedDecklist, MatchReview, TrackedTurn } from '../types.js';

const catalog = new Map(fixture.cards.map(c => [c.id, { ...c, imageDataUrl: `/api/turnlume/card-art/${c.id}.png` } as CardInfo]));
const starting = fixture.deck as CapturedDecklist;
const prizeSources = ['sv5_113', 'sv5_114', 'sv1_186', 'mee_8', 'mee_8', 'sv10_176'];
const cards = starting.cards.flatMap(c => Array.from({length:c.count}, (_,i) => cardInfoToEngineCard(catalog.get(c.cardId), `${c.cardId}-${i}`, c.cardId, c.cardId)));
const prizes = prizeSources.map(id => cards.splice(cards.findIndex(c => cardSourceIdFromReviewCard(c) === id), 1)[0]);
const inPlay = Array.from({length:3}, () => cards.splice(cards.findIndex(c => catalog.get(cardSourceIdFromReviewCard(c)!)?.category === 1), 1)[0]);
const pokemon = (card: Card) => ({ card, attachedEnergy:[], attachedTools:[], statusConditions:[], damageCounters:0, currentHp:60 } as unknown as PokemonInPlay);
const tracked = (card: Card) => ({ id:card.id, cardId:cardSourceIdFromReviewCard(card), name:card.name, imageDataUrl:card.imageUrl });
function Preview() {
  const [stage, setStage] = useState(1), [inspector, setInspector] = useState<ReviewInspector | null>(null);
  function frame(stage: number): TrackedTurn {
  const taking = stage === 2 || stage === 4;
  const remaining = taking ? 5 : 6;
  const hand = [...cards.slice(0,7), ...(taking ? [prizes[0]] : [])];
  const deck = cards.slice(7).map(c => stage === 0 ? hiddenReviewCard(c.id) : c);
  const player = { active:pokemon(inPlay[0]), bench:inPlay.slice(1).map(pokemon), hand, deck, discard:[], lostZone:[],
    prizes:Array.from({length:remaining},(_,i)=>hiddenReviewCard(`hidden-prize-${i}`)) } as unknown as PlayerState;
  const board = { name:'You', active:{...tracked(inPlay[0]),damage:0,energies:[],evolutionStack:[]},
    bench:inPlay.slice(1).map(c=>({...tracked(c),damage:0,energies:[],evolutionStack:[]})),
    handCount:hand.length, deckCount:deck.length, deckCountKnown:true, knownHand:hand.map(c=>c.name),
    discard:[], discardCards:[], prizesTaken:6-remaining } as TrackedPlayerBoard;
  const visibility = Object.fromEntries([...inPlay,...hand,...deck,...player.prizes].map(c=>[c.id,cardSourceIdFromReviewCard(c)?'known':'hidden'])) as Record<string,ReviewCardVisibility>;
  if (stage >= 3) { player.hand.splice(1,1); board.handCount--; }
  return { index:stage,label:'Turn 1',events:[],snapshot:{players:{You:board},stadium:null},
    canonical:{ playerNames:['You','Opponent'],localPlayerIndex:0,visibility,selections:[],appliedEffects:{},
      state:{players:[player,player],stadium:null,currentPlayer:0} } } as unknown as TrackedTurn;
  }
  const selected = frame(stage);
  const review = { id:'prize-preview',localPlayer:'You',opponent:'Opponent',players:['You','Opponent'],
    decklists:[{...starting,playerName:'You'}],turns:stage>=3 ? [frame(1),selected] : [selected] } as MatchReview;
  const player = selected.canonical!.state.players[0], board = selected.snapshot.players.You, visibility = selected.canonical!.visibility;
  const prizeKnowledge = deriveReviewPrizeKnowledge(review,review.turns.length-1,catalog);
  return <main style={{padding:24,maxWidth:1400,margin:'auto'}}><nav style={{display:'flex',gap:12,marginBottom:20}} aria-label="Preview stage">
    {['Before search','After full search','After taking a prize','Missing card data','Take prize with missing data'].map((label,i)=><button key={label} onClick={()=>{setStage(i);setInspector(null);}} aria-pressed={stage===i}>{label}</button>)}
  </nav><PlayerField board={board} decklist={{...starting,playerName:'You'}} canonical={player} visibility={visibility} catalog={catalog} prizeKnowledge={prizeKnowledge}
    choiceFrames={[]} currentReviewIndex={stage} turnNumber={1} status={{isCurrentTurn:true,supporterUsed:false,stadiumUsed:false,itemLocked:false}}
    stadiumCard={null} localPlayerName="You" opponentName="Opponent" defeatedIds={new Set()} defeatedNames={new Set()} damageChanges={new Map()} positionChanges={new Map()}
    avatar="/tracker-assets/trainer-casey.png" onOpenPokemon={()=>{}} onOpenChoice={()=>{}} onOpenCard={card=>setInspector({kind:'card',card})}
    onOpenZone={(title,subtitle,cards,visibility)=>setInspector({kind:'zone',title,subtitle,cards,visibility})} />
    <ReviewOverlay inspector={inspector} catalog={catalog} onClose={()=>setInspector(null)} onInspectCard={card=>setInspector({kind:'card',card})}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
