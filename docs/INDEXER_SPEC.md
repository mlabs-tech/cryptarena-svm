# Cryptarena Indexer Service Specification

## Overview

This document specifies the indexer service for the Cryptarena SVM protocol. The indexer monitors on-chain events and account changes, storing them in a PostgreSQL database for efficient querying by the frontend and analytics systems.

---

## Table of Contents

1. [On-Chain Data Structures](#on-chain-data-structures)
2. [Events to Index](#events-to-index)
3. [PostgreSQL Database Schema](#postgresql-database-schema)
4. [Indexer Service Architecture](#indexer-service-architecture)
5. [API Endpoints](#api-endpoints)
6. [Implementation Guide](#implementation-guide)
7. [Deployment](#deployment)

---

## On-Chain Data Structures

### 1. GlobalState Account

**PDA Seeds:** `["global_state_v2"]`

| Field | Type | Description |
|-------|------|-------------|
| `admin` | Pubkey (32 bytes) | Admin wallet address |
| `treasury_wallet` | Pubkey (32 bytes) | Treasury wallet for 10% fees |
| `arena_duration` | i64 | Arena duration in seconds (default: 60) |
| `current_arena_id` | u64 | Auto-incrementing arena counter |
| `max_players_per_arena` | u8 | Maximum players per arena (default: 10) |
| `max_same_asset` | u8 | Max players with same token (default: 3) |
| `is_paused` | bool | Protocol pause status |
| `bump` | u8 | PDA bump seed |

### 2. Arena Account

**PDA Seeds:** `["arena_v2", arena_id.to_le_bytes()]`

| Field | Type | Description |
|-------|------|-------------|
| `id` | u64 | Unique arena identifier |
| `status` | u8 | Arena status (see ArenaStatus enum) |
| `player_count` | u8 | Current number of players (0-10) |
| `asset_count` | u8 | Number of unique assets in arena |
| `prices_set` | u8 | Number of start prices set |
| `end_prices_set` | u8 | Number of end prices set |
| `winning_asset` | u8 | Index of winning asset (0-13) |
| `is_suspended` | bool | Whether arena is suspended |
| `bump` | u8 | PDA bump seed |
| `start_timestamp` | i64 | Unix timestamp when arena started |
| `end_timestamp` | i64 | Unix timestamp when arena ends |
| `total_pool` | u64 | Total USD value in pool (6 decimals) |

**ArenaStatus Enum:**
```
0 = Uninitialized
1 = Waiting      (accepting players)
2 = Ready        (10 players, waiting for prices)
3 = Active       (prices set, countdown running)
4 = Ended        (finalized, rewards claimable)
5 = Suspended    (paused/error state)
6 = Starting     (setting start prices)
7 = Ending       (setting end prices)
```

### 3. ArenaAsset Account

**PDA Seeds:** `["arena_asset_v2", arena_pda, asset_index]`

| Field | Type | Description |
|-------|------|-------------|
| `arena` | Pubkey (32 bytes) | Parent arena PDA |
| `asset_index` | u8 | Asset index (0-13) |
| `player_count` | u8 | Players who chose this asset |
| `start_price` | u64 | Start price (8 decimals, e.g., $100 = 10000000000) |
| `end_price` | u64 | End price (8 decimals) |
| `price_movement` | i64 | Price change in basis points (bps) |
| `bump` | u8 | PDA bump seed |

### 4. PlayerEntry Account

**PDA Seeds:** `["player_entry_v2", arena_pda, player_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| `arena` | Pubkey (32 bytes) | Parent arena PDA |
| `player` | Pubkey (32 bytes) | Player wallet address |
| `asset_index` | u8 | Chosen asset index |
| `player_index` | u8 | Order of entry (0-9) |
| `amount` | u64 | Token amount deposited (9 decimals) |
| `usd_value` | u64 | USD value at entry (6 decimals) |
| `entry_timestamp` | i64 | Unix timestamp of entry |
| `is_winner` | bool | Whether player won |
| `own_tokens_claimed` | bool | Whether own tokens claimed |
| `rewards_claimed_bitmap` | u128 | Bitmap of claimed loser rewards |
| `bump` | u8 | PDA bump seed |

### 5. Supported Assets

| Index | Symbol | Name | Mint Address (Devnet) |
|-------|--------|------|----------------------|
| 0 | SOL | Solana | (from token-mints-admin.json) |
| 1 | TRUMP | Trump | |
| 2 | PUMP | Pump | |
| 3 | BONK | Bonk | |
| 4 | JUP | Jupiter | |
| 5 | PENGU | Pengu | |
| 6 | PYTH | Pyth | |
| 7 | HNT | Helium | |
| 8 | FARTCOIN | Fartcoin | |
| 9 | RAY | Raydium | |
| 10 | WIF | Dogwifhat | |
| 11 | RENDER | Render | |
| 12 | ONDO | Ondo | |
| 13 | MEW | Mew | |

---

## Events to Index

### Transaction Instructions to Monitor

| Instruction | Description | Key Data |
|-------------|-------------|----------|
| `initialize` | Protocol initialization | admin, treasury_wallet |
| `update_settings` | Settings update | arena_duration, max_players, etc. |
| `enter_arena` | Player joins arena | player, asset_index, amount, usd_value |
| `set_start_price` | Admin sets start price | asset_index, price |
| `set_end_price` | Admin sets end price | asset_index, price |
| `finalize_arena` | Arena winner determined | winning_asset |
| `claim_own_tokens` | Winner claims own tokens | player, amount |
| `claim_loser_tokens` | Winner claims loser tokens | winner, loser, amount, treasury_fee |

### Derived Events

| Event Type | Trigger | Data |
|------------|---------|------|
| `arena_created` | First player enters new arena | arena_id |
| `arena_full` | 10th player joins | arena_id, players |
| `arena_started` | All start prices set | arena_id, start_timestamp |
| `arena_ended` | finalize_arena called | arena_id, winning_asset, winners |
| `reward_claimed` | claim_own/loser_tokens | player, token, amount |

---

## PostgreSQL Database Schema

### Tables

```sql
-- ============================================================================
-- CORE TABLES
-- ============================================================================

CREATE TABLE protocol_state (
    id SERIAL PRIMARY KEY,
    program_id VARCHAR(44) NOT NULL,
    admin VARCHAR(44) NOT NULL,
    treasury_wallet VARCHAR(44) NOT NULL,
    arena_duration INTEGER NOT NULL DEFAULT 60,
    current_arena_id BIGINT NOT NULL DEFAULT 0,
    max_players_per_arena SMALLINT NOT NULL DEFAULT 10,
    max_same_asset SMALLINT NOT NULL DEFAULT 3,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(program_id)
);

CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    index SMALLINT NOT NULL UNIQUE,
    symbol VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    mint_address VARCHAR(44),
    decimals SMALLINT NOT NULL DEFAULT 9,
    pyth_feed_id VARCHAR(66),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE arenas (
    id BIGSERIAL PRIMARY KEY,
    arena_id BIGINT NOT NULL UNIQUE,
    pda VARCHAR(44) NOT NULL UNIQUE,
    status SMALLINT NOT NULL DEFAULT 1,
    player_count SMALLINT NOT NULL DEFAULT 0,
    asset_count SMALLINT NOT NULL DEFAULT 0,
    winning_asset SMALLINT,
    is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    start_timestamp TIMESTAMP WITH TIME ZONE,
    end_timestamp TIMESTAMP WITH TIME ZONE,
    total_pool_usd DECIMAL(20, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE arena_assets (
    id BIGSERIAL PRIMARY KEY,
    arena_id BIGINT NOT NULL REFERENCES arenas(arena_id),
    pda VARCHAR(44) NOT NULL UNIQUE,
    asset_index SMALLINT NOT NULL,
    player_count SMALLINT NOT NULL DEFAULT 0,
    start_price DECIMAL(20, 8),
    end_price DECIMAL(20, 8),
    price_movement_bps INTEGER,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(arena_id, asset_index)
);

CREATE TABLE player_entries (
    id BIGSERIAL PRIMARY KEY,
    arena_id BIGINT NOT NULL REFERENCES arenas(arena_id),
    pda VARCHAR(44) NOT NULL UNIQUE,
    player_wallet VARCHAR(44) NOT NULL,
    player_index SMALLINT NOT NULL,
    asset_index SMALLINT NOT NULL,
    token_amount DECIMAL(30, 9) NOT NULL,
    usd_value DECIMAL(20, 6) NOT NULL,
    entry_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    own_tokens_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    rewards_claimed_count SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(arena_id, player_wallet)
);

-- ============================================================================
-- EVENT TABLES
-- ============================================================================

CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    signature VARCHAR(88) NOT NULL UNIQUE,
    slot BIGINT NOT NULL,
    block_time TIMESTAMP WITH TIME ZONE,
    instruction_type VARCHAR(50) NOT NULL,
    program_id VARCHAR(44) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE arena_events (
    id BIGSERIAL PRIMARY KEY,
    arena_id BIGINT NOT NULL REFERENCES arenas(arena_id),
    event_type VARCHAR(50) NOT NULL,
    transaction_signature VARCHAR(88) REFERENCES transactions(signature),
    data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE player_actions (
    id BIGSERIAL PRIMARY KEY,
    arena_id BIGINT NOT NULL REFERENCES arenas(arena_id),
    player_wallet VARCHAR(44) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    transaction_signature VARCHAR(88) REFERENCES transactions(signature),
    asset_index SMALLINT,
    token_amount DECIMAL(30, 9),
    usd_value DECIMAL(20, 6),
    data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE reward_claims (
    id BIGSERIAL PRIMARY KEY,
    arena_id BIGINT NOT NULL REFERENCES arenas(arena_id),
    winner_wallet VARCHAR(44) NOT NULL,
    loser_wallet VARCHAR(44),
    transaction_signature VARCHAR(88) REFERENCES transactions(signature),
    asset_index SMALLINT NOT NULL,
    claim_type VARCHAR(20) NOT NULL, -- 'own_tokens' or 'loser_tokens'
    winner_amount DECIMAL(30, 9) NOT NULL,
    treasury_amount DECIMAL(30, 9) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- ANALYTICS TABLES
-- ============================================================================

CREATE TABLE player_stats (
    id BIGSERIAL PRIMARY KEY,
    player_wallet VARCHAR(44) NOT NULL UNIQUE,
    total_arenas_played INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    total_losses INTEGER NOT NULL DEFAULT 0,
    total_usd_wagered DECIMAL(20, 6) NOT NULL DEFAULT 0,
    total_usd_won DECIMAL(20, 6) NOT NULL DEFAULT 0,
    total_usd_lost DECIMAL(20, 6) NOT NULL DEFAULT 0,
    favorite_asset SMALLINT,
    win_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
    last_played_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE asset_stats (
    id SERIAL PRIMARY KEY,
    asset_index SMALLINT NOT NULL UNIQUE,
    times_chosen INTEGER NOT NULL DEFAULT 0,
    times_won INTEGER NOT NULL DEFAULT 0,
    win_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
    total_volume_usd DECIMAL(20, 6) NOT NULL DEFAULT 0,
    avg_price_movement_bps INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE daily_stats (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_arenas INTEGER NOT NULL DEFAULT 0,
    total_players INTEGER NOT NULL DEFAULT 0,
    unique_players INTEGER NOT NULL DEFAULT 0,
    total_volume_usd DECIMAL(20, 6) NOT NULL DEFAULT 0,
    total_treasury_fees_usd DECIMAL(20, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_arenas_status ON arenas(status);
CREATE INDEX idx_arenas_created_at ON arenas(created_at);
CREATE INDEX idx_arena_assets_arena_id ON arena_assets(arena_id);
CREATE INDEX idx_player_entries_arena_id ON player_entries(arena_id);
CREATE INDEX idx_player_entries_wallet ON player_entries(player_wallet);
CREATE INDEX idx_player_entries_winner ON player_entries(is_winner) WHERE is_winner = TRUE;
CREATE INDEX idx_transactions_slot ON transactions(slot);
CREATE INDEX idx_transactions_type ON transactions(instruction_type);
CREATE INDEX idx_arena_events_arena_id ON arena_events(arena_id);
CREATE INDEX idx_arena_events_type ON arena_events(event_type);
CREATE INDEX idx_player_actions_wallet ON player_actions(player_wallet);
CREATE INDEX idx_reward_claims_arena ON reward_claims(arena_id);
CREATE INDEX idx_reward_claims_winner ON reward_claims(winner_wallet);
CREATE INDEX idx_daily_stats_date ON daily_stats(date);

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE VIEW active_arenas AS
SELECT 
    a.*,
    ARRAY_AGG(DISTINCT aa.asset_index) as assets,
    ARRAY_AGG(DISTINCT pe.player_wallet) as players
FROM arenas a
LEFT JOIN arena_assets aa ON a.arena_id = aa.arena_id
LEFT JOIN player_entries pe ON a.arena_id = pe.arena_id
WHERE a.status IN (1, 2, 3, 6, 7)
GROUP BY a.id;

CREATE VIEW leaderboard AS
SELECT 
    player_wallet,
    total_wins,
    total_arenas_played,
    win_rate,
    total_usd_won - total_usd_lost as net_profit,
    last_played_at
FROM player_stats
ORDER BY total_wins DESC, win_rate DESC
LIMIT 100;

CREATE VIEW recent_winners AS
SELECT 
    pe.player_wallet,
    a.arena_id,
    pe.asset_index,
    assets.symbol as asset_symbol,
    a.total_pool_usd,
    a.end_timestamp
FROM player_entries pe
JOIN arenas a ON pe.arena_id = a.arena_id
JOIN assets ON pe.asset_index = assets.index
WHERE pe.is_winner = TRUE
ORDER BY a.end_timestamp DESC
LIMIT 50;
```

### Seed Data

```sql
-- Insert supported assets
INSERT INTO assets (index, symbol, name, decimals) VALUES
(0, 'SOL', 'Solana', 9),
(1, 'TRUMP', 'Trump', 9),
(2, 'PUMP', 'Pump', 9),
(3, 'BONK', 'Bonk', 9),
(4, 'JUP', 'Jupiter', 9),
(5, 'PENGU', 'Pengu', 9),
(6, 'PYTH', 'Pyth', 9),
(7, 'HNT', 'Helium', 9),
(8, 'FARTCOIN', 'Fartcoin', 9),
(9, 'RAY', 'Raydium', 9),
(10, 'WIF', 'Dogwifhat', 9),
(11, 'RENDER', 'Render', 9),
(12, 'ONDO', 'Ondo', 9),
(13, 'MEW', 'Mew', 9);
```

---

## Indexer Service Architecture

### Technology Stack

- **Language:** TypeScript (Node.js)
- **Database:** PostgreSQL 15+
- **Solana SDK:** `@solana/web3.js`, `@coral-xyz/anchor`
- **Queue:** Bull (Redis-backed) for job processing
- **Cache:** Redis for RPC response caching
- **HTTP Framework:** Fastify or Express

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Indexer Service                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  WebSocket  │    │   Account   │    │   Block     │         │
│  │  Listener   │───▶│   Poller    │───▶│   Processor │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────────────────────────────────────────┐           │
│  │                  Event Parser                    │           │
│  │  (Decode Anchor instructions & accounts)        │           │
│  └─────────────────────────────────────────────────┘           │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────┐           │
│  │                  Job Queue (Bull)                │           │
│  │  - account_update                               │           │
│  │  - transaction_process                          │           │
│  │  - stats_compute                                │           │
│  └─────────────────────────────────────────────────┘           │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────┐           │
│  │               Database Writer                    │           │
│  │  (Batch inserts, upserts, transactions)         │           │
│  └─────────────────────────────────────────────────┘           │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────┐           │
│  │                  PostgreSQL                      │           │
│  └─────────────────────────────────────────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
indexer-service/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   ├── index.ts            # Configuration loader
│   │   ├── database.ts         # Database connection
│   │   └── solana.ts           # Solana RPC connection
│   ├── listeners/
│   │   ├── websocket.ts        # WebSocket account listener
│   │   ├── poller.ts           # Fallback account poller
│   │   └── blocks.ts           # Block/slot processor
│   ├── parsers/
│   │   ├── accounts.ts         # Account data parser
│   │   ├── instructions.ts     # Instruction decoder
│   │   └── events.ts           # Event extractor
│   ├── processors/
│   │   ├── arena.ts            # Arena state processor
│   │   ├── player.ts           # Player entry processor
│   │   ├── claims.ts           # Reward claim processor
│   │   └── stats.ts            # Stats aggregator
│   ├── jobs/
│   │   ├── queue.ts            # Bull queue setup
│   │   ├── workers.ts          # Job workers
│   │   └── handlers/
│   │       ├── accountUpdate.ts
│   │       ├── transactionProcess.ts
│   │       └── statsCompute.ts
│   ├── db/
│   │   ├── migrations/         # Database migrations
│   │   ├── models/             # TypeORM/Prisma models
│   │   └── repositories/       # Data access layer
│   ├── api/
│   │   ├── server.ts           # HTTP server
│   │   └── routes/
│   │       ├── arenas.ts
│   │       ├── players.ts
│   │       ├── stats.ts
│   │       └── health.ts
│   ├── utils/
│   │   ├── pda.ts              # PDA derivation helpers
│   │   ├── decode.ts           # Anchor decode helpers
│   │   └── logger.ts           # Logging utility
│   └── types/
│       ├── accounts.ts         # Account type definitions
│       ├── events.ts           # Event type definitions
│       └── api.ts              # API type definitions
├── prisma/
│   └── schema.prisma           # Prisma schema (alternative to raw SQL)
├── scripts/
│   ├── migrate.ts              # Database migration runner
│   ├── backfill.ts             # Historical data backfill
│   └── seed.ts                 # Seed data
├── tests/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

---

## API Endpoints

### Arenas

```
GET  /api/v1/arenas                    # List arenas (paginated)
GET  /api/v1/arenas/active             # Get active/waiting arenas
GET  /api/v1/arenas/:id                # Get arena by ID
GET  /api/v1/arenas/:id/players        # Get arena players
GET  /api/v1/arenas/:id/assets         # Get arena assets with prices
GET  /api/v1/arenas/:id/claims         # Get reward claims for arena
```

### Players

```
GET  /api/v1/players/:wallet           # Get player profile
GET  /api/v1/players/:wallet/history   # Get player arena history
GET  /api/v1/players/:wallet/stats     # Get player statistics
GET  /api/v1/players/:wallet/claims    # Get player's reward claims
```

### Stats & Leaderboard

```
GET  /api/v1/stats                     # Global protocol stats
GET  /api/v1/stats/daily               # Daily stats (last 30 days)
GET  /api/v1/stats/assets              # Asset performance stats
GET  /api/v1/leaderboard               # Top players leaderboard
GET  /api/v1/leaderboard/weekly        # Weekly leaderboard
```

### WebSocket Events

```
ws://host/ws

Events:
- arena:created       { arenaId, timestamp }
- arena:player_joined { arenaId, player, assetIndex, playerCount }
- arena:started       { arenaId, startTimestamp, endTimestamp }
- arena:ended         { arenaId, winningAsset, winners }
- player:claimed      { arenaId, player, assetIndex, amount }
```

---

## Implementation Guide

### Step 1: Project Setup

```bash
mkdir indexer-service && cd indexer-service
npm init -y
npm install typescript ts-node @types/node --save-dev
npm install @solana/web3.js @coral-xyz/anchor
npm install pg prisma @prisma/client
npm install bull ioredis
npm install fastify @fastify/websocket
npm install dotenv winston
npx tsc --init
npx prisma init
```

### Step 2: Environment Configuration

```env
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/cryptarena
REDIS_URL=redis://localhost:6379

SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com

PROGRAM_ID=2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9
GLOBAL_STATE_PDA=<computed>

LOG_LEVEL=info
PORT=3000
```

### Step 3: Core Implementation Order

1. **Database Setup**
   - Create Prisma schema or run raw SQL migrations
   - Seed assets table

2. **Account Decoders**
   - Implement Anchor account deserialization
   - Create PDA derivation utilities

3. **Listeners**
   - WebSocket subscription to program accounts
   - Fallback polling for missed updates

4. **Processors**
   - Arena state machine handler
   - Player entry processor
   - Claim tracker

5. **Stats Aggregation**
   - Scheduled jobs for daily stats
   - Real-time leaderboard updates

6. **API Layer**
   - REST endpoints
   - WebSocket for live updates

### Step 4: Account Subscription Pattern

```typescript
// Example: Subscribe to all program accounts
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';

const PROGRAM_ID = new PublicKey('2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9');

async function subscribeToProgram(connection: Connection) {
  // Subscribe to all program accounts
  const subscriptionId = connection.onProgramAccountChange(
    PROGRAM_ID,
    async (accountInfo, context) => {
      const accountData = accountInfo.accountInfo.data;
      
      // Determine account type by discriminator (first 8 bytes)
      const discriminator = accountData.slice(0, 8);
      
      // Process based on account type
      // Queue job for processing
    },
    'confirmed'
  );
  
  return subscriptionId;
}
```

### Step 5: Transaction Parsing

```typescript
// Example: Parse transactions for a signature
import { Connection, ParsedTransactionWithMeta } from '@solana/web3.js';

async function parseTransaction(
  connection: Connection, 
  signature: string
): Promise<void> {
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0
  });
  
  if (!tx?.meta || tx.meta.err) return;
  
  // Extract instruction data
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId.equals(PROGRAM_ID)) {
      // Decode Anchor instruction
      // Extract accounts and data
      // Queue for processing
    }
  }
}
```

### Step 6: Backfill Script

```typescript
// scripts/backfill.ts
async function backfillHistoricalData() {
  // 1. Fetch GlobalState to get current_arena_id
  // 2. For each arena 0 to current_arena_id:
  //    - Fetch Arena account
  //    - Fetch all ArenaAsset accounts
  //    - Fetch all PlayerEntry accounts
  //    - Insert into database
  // 3. Mark as synced
}
```

---

## Deployment

### Docker Compose

```yaml
version: '3.8'

services:
  indexer:
    build: .
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/cryptarena
      - REDIS_URL=redis://redis:6379
      - SOLANA_RPC_URL=${SOLANA_RPC_URL}
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=cryptarena
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    ports:
      - "6379:6379"

volumes:
  pgdata:
  redisdata:
```

### Health Checks

The indexer should expose health endpoints:

```
GET /health         # Basic health check
GET /health/db      # Database connectivity
GET /health/rpc     # Solana RPC connectivity
GET /health/sync    # Sync status (last processed slot)
```

---

## Key Implementation Notes

1. **Idempotency**: All processors must be idempotent - the same event processed twice should produce the same result.

2. **Ordering**: Process events in slot order to maintain consistency.

3. **Error Handling**: Failed jobs should be retried with exponential backoff.

4. **Caching**: Cache frequently accessed data (active arenas, leaderboard) in Redis.

5. **Rate Limiting**: Implement rate limiting on RPC calls to avoid throttling.

6. **Monitoring**: Add metrics for:
   - Sync lag (current slot vs processed slot)
   - Queue depth
   - Processing latency
   - Database query performance

---

## Testing Checklist

- [ ] Account deserialization for all account types
- [ ] PDA derivation matches on-chain addresses
- [ ] Transaction parsing extracts correct data
- [ ] Database inserts/updates work correctly
- [ ] WebSocket reconnection on disconnect
- [ ] Backfill script processes historical data
- [ ] API endpoints return correct data
- [ ] Stats aggregation is accurate
- [ ] Load testing with concurrent updates

