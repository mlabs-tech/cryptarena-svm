# Arena Duration Update Guide

## Overview

The arena duration is now **fully customizable** through an admin function. This allows you to change the duration without redeploying the program.

## Changes Made

### 1. Solana Program Updates (`lib.rs`)

- **Added `update_arena_duration` function** (lines 73-87): Admin-only function to update the global arena duration
- **Added `InvalidDuration` error**: Validates that duration must be greater than 0

### 2. New Script: `update-arena-duration.ts`

A script to easily update the arena duration from the command line.

## How to Use

### Step 1: Rebuild and Redeploy the Program

```bash
cd cryptarena-svm
anchor build
anchor deploy
```

### Step 2: Update the Duration to 10 Minutes

```bash
npx ts-node scripts/update-arena-duration.ts 600
```

Or for other durations:
```bash
npx ts-node scripts/update-arena-duration.ts 300   # 5 minutes
npx ts-node scripts/update-arena-duration.ts 900   # 15 minutes
npx ts-node scripts/update-arena-duration.ts 1800  # 30 minutes
```

## Current Setup

- **Default Duration**: 60 seconds (1 minute) - defined in `DEFAULT_ARENA_DURATION` constant
- **Current Setting**: Set in `global_state.arena_duration`
- **Where It's Used**: When an arena transitions to Active status (line 199), the `end_timestamp` is calculated as `start_time + arena_duration`

## Important Notes

1. **Admin Only**: Only the admin wallet can update the duration
2. **Affects Future Arenas**: The new duration applies to all arenas created AFTER the update
3. **Active Arenas**: Already active arenas will keep their original end time
4. **Validation**: Duration must be greater than 0

## Example Output

```
═══════════════════════════════════════════════════════════════════════════════
⏱️  UPDATE ARENA DURATION
═══════════════════════════════════════════════════════════════════════════════

📋 Program ID: 2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9
👤 Admin: YourAdminPublicKey...
🌐 Cluster: https://api.devnet.solana.com

📊 Current Global State:
   Current Duration: 60 seconds (1 minutes)
   Admin: YourAdminPublicKey...
   Max Players: 10

═══════════════════════════════════════════════════════════════════════════════
🔄 Updating arena duration to 600 seconds (10 minutes)...
═══════════════════════════════════════════════════════════════════════════════

✅ Arena duration updated successfully!
   Transaction: 5xTxHashExample...

📊 Updated Global State:
   New Duration: 600 seconds (10 minutes)
   Max Players: 10

🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉
✅ DURATION UPDATE COMPLETE!
🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉
```

## Technical Details

### Function Signature

```rust
pub fn update_arena_duration(
    ctx: Context<AdminOnly>,
    arena_duration: i64,
) -> Result<()>
```

### Access Control

- Uses the same `AdminOnly` context as other admin functions
- Verifies that the signer matches `global_state.admin`

### Validation

- Ensures `arena_duration > 0`
- Returns `InvalidDuration` error if validation fails

