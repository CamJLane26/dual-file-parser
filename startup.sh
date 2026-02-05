#!/bin/bash

# Dual File Parser Startup Script
# Supports CSV, TSV, and tab-separated text files

set -e

echo "Starting Dual File Parser..."

# Default environment variables
export PORT=${PORT:-3001}
export NODE_HEAP_SIZE=${NODE_HEAP_SIZE:-4096}
export USE_DATABASE=${USE_DATABASE:-false}
export USE_DYNAMIC_SCHEMA=${USE_DYNAMIC_SCHEMA:-true}
export DB_BATCH_SIZE=${DB_BATCH_SIZE:-100}
export BATCH_FLUSH_INTERVAL_MS=${BATCH_FLUSH_INTERVAL_MS:-5000}
export DB_TABLE_NAME=${DB_TABLE_NAME:-records}

# Database configuration (only used if USE_DATABASE=true)
export DB_HOST=${DB_HOST:-localhost}
export DB_PORT=${DB_PORT:-5432}
export DB_NAME=${DB_NAME:-csvparser}
export DB_USER=${DB_USER:-postgres}
export DB_PASSWORD=${DB_PASSWORD:-}

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Check if build directory exists (for production)
if [ "$NODE_ENV" = "production" ]; then
    if [ ! -d "build" ]; then
        echo "Building TypeScript..."
        npm run build
    fi
    echo "Running in production mode..."
    npm start
else
    echo "Running in development mode..."
    npm run dev
fi
