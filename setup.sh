#!/bin/bash
# Pokemon TCG AI - One-shot setup script
# Run this in your terminal: bash ~/pokemon-tcg-ai/setup.sh

set -e

echo "🎴 Pokemon TCG AI - Setup"
echo "========================="

# Step 1: Install Homebrew if missing
if ! command -v brew &> /dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
else
    echo "✅ Homebrew already installed"
fi

# Step 2: Install Node.js if missing
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    brew install node
else
    echo "✅ Node.js already installed ($(node --version))"
fi

# Step 3: Install dependencies
echo "📦 Installing project dependencies..."
cd ~/pokemon-tcg-ai
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "Run these next:"
echo "  cd ~/pokemon-tcg-ai"
echo "  npm run benchmark"
echo "  npm run train"
