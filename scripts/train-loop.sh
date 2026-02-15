#!/bin/bash
# Full AlphaZero-style training loop for Pokemon TCG AI.
#
# Phase 1: Quick imitation from heuristic (~5 min)
# Phase 2: Self-play ISMCTS iterations (overnight)
#
# Usage: bash scripts/train-loop.sh

set -e

# Setup fnm for node
export PATH="$HOME/.fnm:$PATH"
eval "$(fnm env --use-on-cd --shell bash 2>/dev/null || true)"

# Unbuffered Python output for real-time logging
export PYTHONUNBUFFERED=1

cd "$(dirname "$0")/.."

MODELS_DIR="models"
DATA_DIR="data"
LOG_FILE="training.log"
mkdir -p "$MODELS_DIR" "$DATA_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "========================================"
log "  Pokemon TCG AI Training Pipeline"
log "========================================"

SKIP_PHASE1=false
START_ITER=1
for arg in "$@"; do
  if [[ "$arg" == "--skip-phase1" ]]; then SKIP_PHASE1=true; fi
  if [[ "$arg" == --start-iter=* ]]; then START_ITER="${arg#*=}"; fi
done

# ============================================
# PHASE 1: Quick Imitation Learning (~5 min)
# ============================================

if [[ "$SKIP_PHASE1" == "true" ]]; then
  log "Skipping Phase 1 (--skip-phase1 flag)"
else
  log "=== PHASE 1: Imitation Learning ==="

  log "[1/3] Generating imitation data (500 games)..."
  node --import tsx scripts/generate-data.ts --games 500 --output "$DATA_DIR/imitation"

  log "[2/3] Training on GPU (imitation learning)..."
  python3 training/quick_train.py \
    --data "$DATA_DIR/imitation" \
    --output "$MODELS_DIR/latest_weights.json" \
    --epochs 100 \
    --batch-size 256 \
    --lr 1e-3

  log "[3/3] Evaluating trained model vs heuristic..."
  node --import tsx scripts/evaluate.ts \
    --weights "$MODELS_DIR/latest_weights.json" \
    --games 100

  # Save imitation checkpoint (never overwritten by self-play)
  cp "$MODELS_DIR/latest_weights.json" "$MODELS_DIR/imitation_checkpoint.json"
  log "  Saved imitation checkpoint: imitation_checkpoint.json"

  log "=== Phase 1 complete! ==="
fi

# ============================================
# PHASE 2: Self-Play Training (overnight)
# ============================================

log "=== PHASE 2: Self-Play Training ==="

MAX_ITER=${MAX_ITER:-3000}
NUM_WORKERS=${NUM_WORKERS:-10}
TOTAL_GAMES=30
GAMES_PER_WORKER=$((TOTAL_GAMES / NUM_WORKERS))
REMAINDER=$((TOTAL_GAMES % NUM_WORKERS))

log "Config: $MAX_ITER iterations, $NUM_WORKERS workers, $TOTAL_GAMES games/iter"

for iter in $(seq $START_ITER $MAX_ITER); do
  log "--- Iteration $iter/$MAX_ITER ---"
  ITER_DIR="$DATA_DIR/iter_${iter}"
  mkdir -p "$ITER_DIR"

  # Step 1: Generate self-play games in parallel
  log "  Generating $TOTAL_GAMES self-play games (${NUM_WORKERS} workers, 3×50 ISMCTS)..."
  for w in $(seq 0 $((NUM_WORKERS - 1))); do
    OFFSET=$(( (iter - 1) * TOTAL_GAMES + w * GAMES_PER_WORKER ))
    WORKER_GAMES=$GAMES_PER_WORKER
    if [ $w -eq $((NUM_WORKERS - 1)) ]; then
      WORKER_GAMES=$((GAMES_PER_WORKER + REMAINDER))
    fi
    node --import tsx scripts/generate-selfplay.ts \
      --games $WORKER_GAMES \
      --game-offset $OFFSET \
      --output "$ITER_DIR" \
      --weights "$MODELS_DIR/latest_weights.json" \
      --determinizations 3 \
      --simulations 50 &
  done
  wait

  # Step 2: Train on GPU (replay buffer: train on all retained iterations)
  if [ $iter -le 500 ]; then
    LR="2e-4"
  elif [ $iter -le 1500 ]; then
    LR="1e-4"
  else
    LR="5e-5"
  fi

  log "  Training on GPU (lr=$LR)..."
  python3 training/train.py \
    --data "$DATA_DIR" \
    --weights "$MODELS_DIR/latest_weights.json" \
    --output "$MODELS_DIR/latest_weights.json" \
    --epochs 2 \
    --batch-size 512 \
    --lr "$LR" \
    --entropy-coef 0.02

  # Step 3: Delete old iteration data (keep last 8 as replay buffer)
  OLD_ITER=$((iter - 12))
  if [ $OLD_ITER -gt 0 ] && [ -d "$DATA_DIR/iter_$OLD_ITER" ]; then
    rm -rf "$DATA_DIR/iter_$OLD_ITER"
  fi

  # Step 4: Evaluate every 25 iterations (first 200), then every 50
  EVAL_FREQ=50
  if [ $iter -le 200 ]; then EVAL_FREQ=25; fi
  if (( iter % EVAL_FREQ == 0 )); then
    log "  Evaluating..."
    node --import tsx scripts/evaluate.ts \
      --weights "$MODELS_DIR/latest_weights.json" \
      --games 20
  fi

  # Step 5: Checkpoint every 200 iterations
  if (( iter % 200 == 0 )); then
    cp "$MODELS_DIR/latest_weights.json" "$MODELS_DIR/checkpoint_iter_${iter}.json"
    log "  Saved checkpoint: checkpoint_iter_${iter}.json"
  fi

done

log "Training complete!"
