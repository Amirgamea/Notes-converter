#!/bin/bash
set -e

echo "Updating Cabal..."
cabal update

echo "Installing pandoc-unicode-math..."
# Installing via cabal to global bin
cabal install pandoc-unicode-math --install-method=copy --overwrite-policy=always --installdir=/usr/local/bin

echo "Verifying installation..."
if [ -f "/usr/local/bin/pandoc-unicode-math" ]; then
    echo "Success: pandoc-unicode-math installed."
else
    echo "Error: Installation failed."
    exit 1
fi