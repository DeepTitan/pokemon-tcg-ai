"""
Policy-Value Network for Pokemon TCG AI (Action-Scoring Architecture)

Architecture:
  State encoder (policy): 501 → 512 → 256 (MLP with LayerNorm + ReLU)
  Value state encoder:    501 → 512 → 256 (separate MLP for value head)
  Action encoder: 54 → 128 → 64 (MLP per action)
  Action scorer: concat(256, 64) = 320 → 128 → 1 (score per action)
  Value head: 256 → 128 → 1 (tanh)

The network scores each legal action using (state, action) pairs.
Policy = softmax over all action scores for legal actions.
The value head has its own state encoder to avoid gradient conflict with policy.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import json
import numpy as np


STATE_SIZE = 501
ACTION_SIZE = 54


class StateEncoder(nn.Module):
    """Encodes game state into a fixed-size embedding."""

    def __init__(self, hidden=512, embed=256):
        super().__init__()
        self.fc1 = nn.Linear(STATE_SIZE, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, embed)
        self.ln2 = nn.LayerNorm(embed)

    def forward(self, x):
        x = F.relu(self.ln1(self.fc1(x)))
        x = F.relu(self.ln2(self.fc2(x)))
        return x


class ActionEncoder(nn.Module):
    """Encodes action features into a fixed-size embedding."""

    def __init__(self, hidden=128, embed=64):
        super().__init__()
        self.fc1 = nn.Linear(ACTION_SIZE, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, embed)

    def forward(self, x):
        x = F.relu(self.ln1(self.fc1(x)))
        x = self.fc2(x)
        return x


class ActionScorer(nn.Module):
    """Scores a (state_embed, action_embed) pair."""

    def __init__(self, state_dim=256, action_dim=64, hidden=128):
        super().__init__()
        self.fc1 = nn.Linear(state_dim + action_dim, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, 1)

    def forward(self, state_embed, action_embed):
        x = torch.cat([state_embed, action_embed], dim=-1)
        x = F.relu(self.ln1(self.fc1(x)))
        x = self.fc2(x)
        return x.squeeze(-1)


class ValueHead(nn.Module):
    """Predicts game outcome from state embedding."""

    def __init__(self, state_dim=256, hidden=128):
        super().__init__()
        self.fc1 = nn.Linear(state_dim, hidden)
        self.fc2 = nn.Linear(hidden, 1)

    def forward(self, x):
        x = F.relu(self.fc1(x))
        x = torch.tanh(self.fc2(x))
        return x.squeeze(-1)


class PolicyValueNetwork(nn.Module):
    """
    Complete policy-value network for Pokemon TCG AI.

    Given a state and a set of legal actions, produces:
    - policy: probability distribution over legal actions (via softmax of scores)
    - value: scalar estimate of game outcome [-1, 1]
    """

    def __init__(self):
        super().__init__()
        self.state_encoder = StateEncoder()
        self.value_state_encoder = StateEncoder()  # Separate encoder for value head
        self.action_encoder = ActionEncoder()
        self.action_scorer = ActionScorer()
        self.value_head = ValueHead()

    def forward(self, states, action_features, action_mask):
        """
        Args:
            states: (batch, 501) game state features
            action_features: (batch, max_actions, 54) action features, padded
            action_mask: (batch, max_actions) binary mask, 1=valid, 0=padded

        Returns:
            policy_logits: (batch, max_actions) raw scores (masked invalid → -inf)
            values: (batch,) value estimates
        """
        # Encode state for policy: (batch, 256)
        state_embed = self.state_encoder(states)

        # Encode state for value (separate encoder, no gradient conflict): (batch, 256)
        value_state_embed = self.value_state_encoder(states)

        # Encode actions: (batch, max_actions, 64)
        batch_size, max_actions, _ = action_features.shape
        flat_actions = action_features.reshape(-1, ACTION_SIZE)
        flat_action_embed = self.action_encoder(flat_actions)
        action_embed = flat_action_embed.reshape(batch_size, max_actions, -1)

        # Score each action: broadcast state to (batch, max_actions, 256)
        state_expanded = state_embed.unsqueeze(1).expand(-1, max_actions, -1)

        # Flatten for scorer
        flat_state = state_expanded.reshape(-1, state_embed.shape[-1])
        flat_act = action_embed.reshape(-1, action_embed.shape[-1])
        flat_scores = self.action_scorer(flat_state, flat_act)
        scores = flat_scores.reshape(batch_size, max_actions)

        # Mask invalid actions to -inf
        scores = scores.masked_fill(action_mask == 0, float('-inf'))

        # Value from separate state embedding
        values = self.value_head(value_state_embed)

        return scores, values

    def get_policy_and_value(self, states, action_features, action_mask):
        """Returns softmax policy and value."""
        scores, values = self.forward(states, action_features, action_mask)
        policy = F.softmax(scores, dim=-1)
        return policy, values

    def count_parameters(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def _build_graph_manifest(model):
    """Build a graph manifest describing the forward pass for the TS adapter.

    The TS adapter reads this manifest and executes the forward pass generically,
    so changing layer counts/sizes in Python requires no TS code changes.
    """
    graph = {
        'state_encoder': [],
        'value_state_encoder': [],
        'action_encoder': [],
        'action_scorer': [],
        'value_head': [],
    }

    # Discover layers by iterating named modules
    for name, module in model.state_encoder.named_modules():
        if name == '':
            continue
        prefix = f'state_encoder_{name}'
        if isinstance(module, nn.Linear):
            graph['state_encoder'].append({'op': 'linear', 'key': prefix})
        elif isinstance(module, nn.LayerNorm):
            graph['state_encoder'].append({'op': 'layernorm', 'key': prefix})
            graph['state_encoder'].append({'op': 'relu'})

    for name, module in model.value_state_encoder.named_modules():
        if name == '':
            continue
        prefix = f'value_state_encoder_{name}'
        if isinstance(module, nn.Linear):
            graph['value_state_encoder'].append({'op': 'linear', 'key': prefix})
        elif isinstance(module, nn.LayerNorm):
            graph['value_state_encoder'].append({'op': 'layernorm', 'key': prefix})
            graph['value_state_encoder'].append({'op': 'relu'})

    for name, module in model.action_encoder.named_modules():
        if name == '':
            continue
        prefix = f'action_encoder_{name}'
        if isinstance(module, nn.Linear):
            graph['action_encoder'].append({'op': 'linear', 'key': prefix})
        elif isinstance(module, nn.LayerNorm):
            graph['action_encoder'].append({'op': 'layernorm', 'key': prefix})
            graph['action_encoder'].append({'op': 'relu'})

    for name, module in model.action_scorer.named_modules():
        if name == '':
            continue
        prefix = f'action_scorer_{name}'
        if isinstance(module, nn.Linear):
            graph['action_scorer'].append({'op': 'linear', 'key': prefix})
        elif isinstance(module, nn.LayerNorm):
            graph['action_scorer'].append({'op': 'layernorm', 'key': prefix})
            graph['action_scorer'].append({'op': 'relu'})

    for name, module in model.value_head.named_modules():
        if name == '':
            continue
        prefix = f'value_head_{name}'
        if isinstance(module, nn.Linear):
            graph['value_head'].append({'op': 'linear', 'key': prefix})
            # Last linear in value head gets tanh, others get relu
            # We'll fix this below
        elif isinstance(module, nn.LayerNorm):
            graph['value_head'].append({'op': 'layernorm', 'key': prefix})

    # Fix value head: relu after all but last linear, tanh after last linear
    vh = graph['value_head']
    linear_indices = [i for i, op in enumerate(vh) if op['op'] == 'linear']
    for idx in linear_indices[:-1]:
        vh.insert(idx + 1, {'op': 'relu'})
    # Recalculate after insertions
    linear_indices = [i for i, op in enumerate(vh) if op['op'] == 'linear']
    vh.append({'op': 'tanh'})

    return graph


def export_weights(model, path):
    """Export model weights + graph manifest to JSON for TS inference.

    The graph manifest describes the forward pass structure so the TS adapter
    can execute it generically without hardcoded layer names.
    """
    graph = _build_graph_manifest(model)

    weights = {
        '_meta': {
            'version': 2,
            'state_size': STATE_SIZE,
            'action_size': ACTION_SIZE,
            'graph': graph,
        }
    }

    def export_linear(module, name):
        weights[name] = {
            'kernel': module.weight.detach().cpu().numpy().T.tolist(),
            'bias': module.bias.detach().cpu().numpy().tolist(),
        }

    def export_layernorm(module, name):
        weights[name] = {
            'gamma': module.weight.detach().cpu().numpy().tolist(),
            'beta': module.bias.detach().cpu().numpy().tolist(),
        }

    # Export all named submodule weights
    for component_name in ['state_encoder', 'value_state_encoder', 'action_encoder', 'action_scorer', 'value_head']:
        component = getattr(model, component_name)
        for name, module in component.named_modules():
            if name == '':
                continue
            key = f'{component_name}_{name}'
            if isinstance(module, nn.Linear):
                export_linear(module, key)
            elif isinstance(module, nn.LayerNorm):
                export_layernorm(module, key)

    with open(path, 'w') as f:
        json.dump(weights, f)

    print(f'Exported weights to {path} (graph manifest v2)')


def load_weights(model, path):
    """Load weights from JSON (exported by export_weights or Python training)."""
    with open(path, 'r') as f:
        weights = json.load(f)

    def load_linear(module, name):
        module.weight.data = torch.tensor(
            np.array(weights[name]['kernel']).T, dtype=torch.float32
        )
        module.bias.data = torch.tensor(
            np.array(weights[name]['bias']), dtype=torch.float32
        )

    def load_layernorm(module, name):
        module.weight.data = torch.tensor(
            np.array(weights[name]['gamma']), dtype=torch.float32
        )
        module.bias.data = torch.tensor(
            np.array(weights[name]['beta']), dtype=torch.float32
        )

    load_linear(model.state_encoder.fc1, 'state_encoder_fc1')
    load_layernorm(model.state_encoder.ln1, 'state_encoder_ln1')
    load_linear(model.state_encoder.fc2, 'state_encoder_fc2')
    load_layernorm(model.state_encoder.ln2, 'state_encoder_ln2')

    # Value state encoder (tolerate missing for backward compat with old weights)
    if 'value_state_encoder_fc1' in weights:
        load_linear(model.value_state_encoder.fc1, 'value_state_encoder_fc1')
        load_layernorm(model.value_state_encoder.ln1, 'value_state_encoder_ln1')
        load_linear(model.value_state_encoder.fc2, 'value_state_encoder_fc2')
        load_layernorm(model.value_state_encoder.ln2, 'value_state_encoder_ln2')
    else:
        print('  Note: value_state_encoder not found in weights, using random init')

    load_linear(model.action_encoder.fc1, 'action_encoder_fc1')
    load_layernorm(model.action_encoder.ln1, 'action_encoder_ln1')
    load_linear(model.action_encoder.fc2, 'action_encoder_fc2')

    load_linear(model.action_scorer.fc1, 'action_scorer_fc1')
    load_layernorm(model.action_scorer.ln1, 'action_scorer_ln1')
    load_linear(model.action_scorer.fc2, 'action_scorer_fc2')

    load_linear(model.value_head.fc1, 'value_head_fc1')
    load_linear(model.value_head.fc2, 'value_head_fc2')

    print(f'Loaded weights from {path}')


if __name__ == '__main__':
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    print(f'Using device: {device}')

    model = PolicyValueNetwork().to(device)
    print(f'Parameters: {model.count_parameters():,}')

    # Quick test with random data
    batch = 4
    max_actions = 20
    states = torch.randn(batch, STATE_SIZE, device=device)
    actions = torch.randn(batch, max_actions, ACTION_SIZE, device=device)
    mask = torch.ones(batch, max_actions, device=device)
    mask[:, 15:] = 0  # mask out last 5 actions

    scores, values = model(states, actions, mask)
    print(f'Scores shape: {scores.shape}')  # (4, 20)
    print(f'Values shape: {values.shape}')  # (4,)
    print(f'Sample scores: {scores[0, :5].detach().cpu().numpy()}')
    print(f'Sample value: {values[0].item():.4f}')

    # Test export
    export_weights(model, 'models/test_weights.json')
    print('Model test passed!')
