# Cryptarena SVM Protocol

On-chain crypto trading arena protocol built on Solana using Anchor framework.

## Overview

Cryptarena is a decentralized trading arena where users choose one asset from a fixed list of fourteen cryptocurrencies and join a ten-player arena. Each arena processes entries, tracks price data through the Pyth oracle, and concludes with rewards for winning users based on asset price movement.

## Programs

### 1. Cryptarena SVM (Main Protocol)
- **Program ID**: `GjiVESbCveUyk2c1zqbFCzPnuficii3L5ZJHgYHMRhg6`
- Arena management and game logic
- User vaults for deposits/withdrawals
- Pyth oracle price feed integration
- Reward distribution system

### 2. Cryptarena Faucet (Testnet)
- **Program ID**: `9ZaAhicfWbLmdJUzXk2ZT1o5CTdaW6VE8mF9sju15D5E`
- Test token minting for devnet
- 6-hour cooldown per asset
- $15 USD worth of tokens per claim

## Supported Assets (14)

| Asset | Symbol | Pyth Price Feed ID |
|-------|--------|-------------------|
| Solana | SOL | `0xde87506dabfadbef89af2d5d796ebae80ddaea240fc7667aa808fce3629cd8fb` |
| Official Trump | TRUMP | `0x879551021853eec7a7dc827578e8e69da7e4fa8148339aa0d3d5296405be4b1a` |
| Pump.fun | PUMP | `0x7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9` |
| Bonk | BONK | `0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419` |
| Jupiter | JUP | `0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996` |
| Pudgy Penguin | PENGU | `0xbed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61` |
| Pyth Network | PYTH | `0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff` |
| Helium | HNT | `0x649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756` |
| Fartcoin | FARTCOIN | `0x058cd29ef0e714c5affc44f269b2c1899a52da416d7acc147b9da692e6953608` |
| Raydium | RAY | `0x91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a` |
| Jito | JTO | `0xb43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2` |
| Kamino | KMNO | `0xb17e5bc5de742a8a378b54c9c75442b7d51e30ada63f28d9bd28d3c0e26511a0` |
| Meteora | MET | `0x0292e0f405bcd4a496d34e48307f6787349ad2bcd8505c3d3a9f77d81a67a682` |
| Wormhole | W | `0xeff7446475e218517566ea99e72a4abec2e1bd8498b43b7d8331e29dcb059389` |

## Arena Rules

### Entry Requirements
- Entry value must be between **$10 and $20 USD**
- Price validation via Pyth oracle
- Maximum **3 users per asset** per arena

### Arena Capacity
- Each arena hosts **10 players**
- New arena created when no waiting arena exists
- Only **one waiting arena** at any time
- Arena starts immediately when 10th player joins

### Arena Duration
- Default: **10 minutes** (configurable by admin)
- Anyone can call `end_arena` after duration completes

### Winner Determination (Bullish Mode)
- Asset with **highest positive price movement** wins
- If all movements are negative, **least negative** wins
- Ties result in **suspended arena** (all players can withdraw)

### Reward Distribution
- **90%** of pool to winners
- **10%** to treasury
- Single winner: full winner pool
- Multiple winners: proportional split

## Project Structure

```
cryptarena-svm/
├── programs/
│   ├── cryptarena-svm/        # Main arena protocol
│   │   └── src/lib.rs
│   └── cryptarena-faucet/     # Testnet faucet
│       └── src/lib.rs
├── tests/
│   └── cryptarena-svm.ts      # Integration tests
├── target/
│   ├── deploy/                # Compiled .so files
│   ├── idl/                   # Program IDLs
│   └── types/                 # TypeScript types
├── Anchor.toml
├── Cargo.toml
└── package.json
```

## Development

### Prerequisites
- Rust 1.91+
- Solana CLI 3.0+
- Anchor CLI 0.32.1
- Node.js 20+

### Build
```bash
anchor build
```

### Test
```bash
anchor test
```

### Deploy to Devnet
```bash
anchor deploy --provider.cluster devnet
```

## Instructions

### Main Program (cryptarena_svm)

| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize global state with admin settings |
| `update_settings` | Update arena duration, treasury, pause state |
| `enter_arena` | Enter an arena with selected asset |
| `update_end_prices` | Update end prices before resolution |
| `end_arena` | End arena and determine winners |
| `claim_reward` | Claim winnings to user vault |
| `withdraw_suspended` | Withdraw from suspended (tied) arena |
| `init_user_vault` | Initialize user's vault account |
| `withdraw_from_vault` | Withdraw from user vault |
| `transfer_treasury` | Admin: transfer treasury funds |

### Faucet Program (cryptarena_faucet)

| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize faucet with admin |
| `register_token` | Register test token mint |
| `create_test_token` | Create test token metadata |
| `claim` | Claim test tokens ($15 USD worth) |
| `init_user_state` | Initialize user faucet state |
| `set_active` | Admin: pause/unpause faucet |

## Account PDAs

```
Global State:     ["global_state"]
Arena:            ["arena", arena_id]
Player Entry:     ["player_entry", arena_pubkey, player_pubkey]
User Vault:       ["user_vault", user_pubkey]
Arena Vault:      ["arena_vault", arena_pubkey]
Faucet State:     ["faucet_state"]
User Faucet State: ["user_faucet_state", user_pubkey]
Token Metadata:   ["token_metadata", asset_index]
```

## Dependencies

- `anchor-lang`: ^0.32.1
- `anchor-spl`: ^0.32.1
- `pyth-solana-receiver-sdk`: ^1.1.0

## License

MIT

