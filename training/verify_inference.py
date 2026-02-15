"""
Verify that Python and TypeScript inference produce identical results.

Exports a test case (state + actions + expected outputs) that the TS adapter
can validate against. This ensures no drift between training and inference.

Usage: python training/verify_inference.py
"""

import json
import os
import numpy as np
import torch

from model import PolicyValueNetwork, STATE_SIZE, ACTION_SIZE, export_weights


def main():
    # Create model with fixed seed for reproducibility
    torch.manual_seed(42)
    model = PolicyValueNetwork()
    model.eval()

    # Export weights
    os.makedirs('models', exist_ok=True)
    export_weights(model, 'models/test_weights.json')

    # Create deterministic test inputs
    np.random.seed(123)
    state = np.random.randn(STATE_SIZE).astype(np.float32)
    num_actions = 5
    actions = np.random.randn(num_actions, ACTION_SIZE).astype(np.float32)

    # Run forward pass
    with torch.no_grad():
        state_t = torch.from_numpy(state).unsqueeze(0)
        actions_t = torch.from_numpy(actions).unsqueeze(0)
        mask = torch.ones(1, num_actions)

        scores, values = model(state_t, actions_t, mask)
        policy = torch.softmax(scores, dim=-1)

    # Save test case
    test_case = {
        'state': state.tolist(),
        'actions': actions.tolist(),
        'expected_scores': scores[0].numpy().tolist(),
        'expected_value': values[0].item(),
        'expected_policy': policy[0].numpy().tolist(),
    }

    with open('models/test_case.json', 'w') as f:
        json.dump(test_case, f)

    print(f'State size: {STATE_SIZE}')
    print(f'Action size: {ACTION_SIZE}')
    print(f'Num actions: {num_actions}')
    print(f'Scores: {scores[0].numpy().round(4).tolist()}')
    print(f'Value: {values[0].item():.6f}')
    print(f'Policy: {policy[0].numpy().round(4).tolist()}')
    print(f'\nTest case saved to models/test_case.json')
    print(f'Weights saved to models/test_weights.json')
    print(f'\nRun: node --import tsx scripts/verify-inference.ts')


if __name__ == '__main__':
    main()
