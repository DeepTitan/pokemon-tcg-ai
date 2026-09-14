import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerField } from '../TrackerApp.js';
import { ReviewOverlay, type ReviewInspector } from '../ReviewInteractions.js';
import fixture from './fixtures/prize-evolution-proof.json';
import type { Card, PlayerState } from '../../engine/types.js';
import type { CardInfo, TrackedPlayerBoard, ReviewCardVisibility, CapturedDecklist } from '../types.js';
const catalog = new Map(fixture.catalog.map(c => [c.id, { ...c, imageDataUrl: `/api/turnlume/card-art/${c.id}.png` } as CardInfo]));
function Preview() {
  const [index, setIndex] = useState(1), [inspector, setInspector] = useState<ReviewInspector | null>(null);
  const frame = fixture.frames[index];
  return <main style={{padding:24,maxWidth:1400,margin:'auto'}}>
    <nav style={{display:'flex',gap:12,marginBottom:20}} aria-label="Regression frame">
      {['126 · Before evolution','127 · Evolved into Dragapult ex','128 · After evolution'].map((label,i)=><button key={label} aria-pressed={i===index} onClick={()=>{setIndex(i);setInspector(null);}}>{label}</button>)}
    </nav>
    <PlayerField board={frame.board as TrackedPlayerBoard} decklist={fixture.deck as CapturedDecklist} canonical={frame.player as unknown as PlayerState}
      visibility={frame.visibility as Record<string,ReviewCardVisibility>} catalog={catalog} choiceFrames={[]} currentReviewIndex={frame.index} turnNumber={8}
      status={{isCurrentTurn:true,supporterUsed:false,stadiumUsed:false,itemLocked:false}} stadiumCard={frame.stadium as Card} stadiumOwner="pau1ek"
      localPlayerName="isaiahw" opponentName="pau1ek" defeatedIds={new Set()} defeatedNames={new Set()} damageChanges={new Map()} positionChanges={new Map()}
      avatar="/tracker-assets/trainer-casey.png" onOpenPokemon={()=>{}} onOpenChoice={()=>{}} onOpenCard={card=>setInspector({kind:'card',card})}
      onOpenZone={(title,subtitle,cards,visibility)=>setInspector({kind:'zone',title,subtitle,cards,visibility})}/>
    <ReviewOverlay inspector={inspector} catalog={catalog} onClose={()=>setInspector(null)} onInspectCard={card=>setInspector({kind:'card',card})}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
