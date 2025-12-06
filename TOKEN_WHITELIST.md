# Token Whitelist System

## Overview

The token whitelist system ensures that only approved tokens can be used in arenas. This provides security and control over which tokens players can bet with.

## How It Works

### Whitelist Structure

Each whitelisted token is stored in a separate PDA (Program Derived Address) with the following structure:

```rust
pub struct WhitelistedToken {
    pub mint: Pubkey,        // Token mint address
    pub asset_index: u8,     // Index (0-13 for current tokens)
    pub is_active: bool,     // Whether token is active
    pub bump: u8,            // PDA bump
}
```

- **PDA Seeds**: `["whitelist_token_v2", token_mint]`
- **Size**: ~50 bytes per token
- **Scalable**: Can add unlimited tokens

### Entry Validation

When a player enters an arena:

1. The system checks if the token mint has a whitelisted token PDA
2. Verifies the token is active (`is_active = true`)
3. Validates the asset index matches
4. Only then allows the entry

## Current Tokens

The following 14 tokens are configured in `test-wallets/token-mints.json`:

| Index | Symbol    | Mint Address                                  |
|-------|-----------|-----------------------------------------------|
| 0     | SOL       | 7a1eh57mbAvEHevFhsofrGYgGPiNBpwwPzQu4KU85EXe |
| 1     | TRUMP     | 5aTAebL8dn3s4SFDLaMTC866XomLCJ4vY1Z1VTEALSdh |
| 2     | PUMP      | K3vfcZbYhEuEHG6woBVpShURxnVxavhgyP16VM9zChS  |
| 3     | BONK      | DkHvWT5Ayk9ciWhz7FU48A2MdEwZekuRdaYVUGtjZdYB |
| 4     | JUP       | E1JEPG4CcK2AHh3s6FFSHBjdzBqBcYjttL4GBHQGKNGS |
| 5     | PENGU     | BhhivFuau4RFEPTwrdvhzvSQuyezc8nJW8vPsBDoLruz |
| 6     | PYTH      | Cm8Z4DsQ4SP7zc3FTcTHpzyZ8hMR1adiDSG7Hf45dFMt |
| 7     | HNT       | 8dbowGCfdiL7x3tzuKJfbc4WPpHdqRqsHEeqfd5Wh7xn |
| 8     | FARTCOIN  | 2yaeL5SPximYfKHJMvhsaFfmcoA3XUMcKd7buuq7sFnz |
| 9     | RAY       | Dx67K9UyaHsPy7shTmuC4xuHvKGFcSpfzBQQNEgP3Fcf |
| 10    | JTO       | ChMDp2sBn23Zyu2YtGU7M6hQUJzMmMdZ6XmWpsrxRKEr |
| 11    | KMNO      | 2byoKnAGKFFRKcmrxJ7FeizXH1pw2tqN38E7dLs7ogvg |
| 12    | MET       | 4YHdgCq49res2mKd4EUBFtk2krmzt3RLaSUVVkgwMH36 |
| 13    | W         | H9wd9H5wAVXBpsf9VtRKMXtSeUGNWHk33UkywWNvWjDi |

## Usage

### 1. Initialize Whitelist (First Time Setup)

Add all 14 tokens to the whitelist:

```bash
npx ts-node scripts/initialize-whitelist.ts
```

**Expected Output:**
```
✅ Successfully Added: 14
⏭️  Already Whitelisted: 0
❌ Errors: 0
📋 Total Tokens: 14

🎉 ALL TOKENS WHITELISTED SUCCESSFULLY!
```

### 2. Check Whitelist Status

View the current whitelist:

```bash
npx ts-node scripts/check-whitelist.ts
```

**Expected Output:**
```
 0: SOL        | ✅ Active   | Index: 0
 1: TRUMP      | ✅ Active   | Index: 1
 2: PUMP       | ✅ Active   | Index: 2
...

✅ Active: 14
❌ Inactive: 0
⚠️  Not Whitelisted: 0
```

### 3. Add Individual Token

Add a new token to the whitelist:

```bash
npx ts-node scripts/add-whitelisted-token.ts <MINT_ADDRESS> <ASSET_INDEX>
```

**Example:**
```bash
npx ts-node scripts/add-whitelisted-token.ts NewTokenMint111111111111111111111111111 14
```

### 4. Remove Token from Whitelist

Deactivate a token (sets `is_active = false`):

```bash
npx ts-node scripts/remove-whitelisted-token.ts <MINT_ADDRESS>
```

**Example:**
```bash
npx ts-node scripts/remove-whitelisted-token.ts 7a1eh57mbAvEHevFhsofrGYgGPiNBpwwPzQu4KU85EXe
```

## Program Functions

### `add_whitelisted_token`

```rust
pub fn add_whitelisted_token(
    ctx: Context<AddWhitelistedToken>,
    asset_index: u8,
) -> Result<()>
```

- **Admin Only**: ✅
- **Purpose**: Add a new token to the whitelist
- **Parameters**:
  - `asset_index`: The index for this token (0-255)

### `remove_whitelisted_token`

```rust
pub fn remove_whitelisted_token(
    ctx: Context<RemoveWhitelistedToken>,
) -> Result<()>
```

- **Admin Only**: ✅
- **Purpose**: Deactivate a whitelisted token
- **Effect**: Sets `is_active = false` (doesn't delete the account)

## Error Codes

| Error Code            | Message                                    | When It Occurs                           |
|-----------------------|--------------------------------------------|------------------------------------------|
| `TokenNotWhitelisted` | Token is not whitelisted                   | Token PDA doesn't exist or is inactive   |
| `InvalidAssetIndex`   | Asset index does not match whitelisted token | Mismatch between provided and stored index |

## Integration with Enter Arena

The `enter_arena` function now includes whitelist validation:

```rust
// Check token is whitelisted
let whitelisted_token = &ctx.accounts.whitelisted_token;
require!(
    whitelisted_token.is_active,
    CryptarenaError::TokenNotWhitelisted
);
require!(
    whitelisted_token.asset_index == asset_index,
    CryptarenaError::InvalidAssetIndex
);
```

## Best Practices

### 1. Before Deployment

- Initialize the whitelist with all tokens
- Verify all tokens are active using `check-whitelist.ts`

### 2. Adding New Tokens

- Decide on the next available asset index
- Use `add-whitelisted-token.ts` with admin wallet
- Verify the addition with `check-whitelist.ts`
- Update frontend to show the new token

### 3. Removing Tokens

- Use `remove-whitelisted-token.ts` to deactivate
- Token can be reactivated later if needed (requires program update for reactivation function)

### 4. Security

- Only the admin wallet can add/remove tokens
- Always verify the admin wallet is secure
- Test on devnet before mainnet deployment

## Deployment Steps

### Complete Setup (After Deploying Program)

```bash
# 1. Rebuild and deploy the program
cd cryptarena-svm
anchor build
anchor deploy

# 2. Initialize the whitelist
npx ts-node scripts/initialize-whitelist.ts

# 3. Verify all tokens are whitelisted
npx ts-node scripts/check-whitelist.ts

# 4. Test entering an arena (should now work)
npx ts-node scripts/fill-arena.ts
```

## Troubleshooting

### Error: "Token is not whitelisted"

**Solution**: Add the token to the whitelist:
```bash
npx ts-node scripts/add-whitelisted-token.ts <MINT> <INDEX>
```

### Error: "Asset index does not match"

**Cause**: The token is whitelisted but with a different index.

**Solution**: 
1. Check current index: `npx ts-node scripts/check-whitelist.ts`
2. Use the correct index when entering arena

### Error: "Unauthorized"

**Cause**: Not using the admin wallet.

**Solution**: Ensure you're using the admin wallet configured during initialization.

## Future Enhancements

Potential improvements for the whitelist system:

1. **Reactivate Function**: Allow admin to reactivate deactivated tokens
2. **Batch Operations**: Add/remove multiple tokens in one transaction
3. **Token Metadata**: Store additional info (name, decimals, etc.)
4. **Tiered Access**: Different token tiers with different rules
5. **Automatic Indexing**: Auto-assign next available index

## Migration from Old Version

If you have an existing deployment without whitelist:

1. **Deploy Updated Program**: Use `anchor upgrade`
2. **Initialize Whitelist**: Run `initialize-whitelist.ts`
3. **Update Frontend**: Add whitelist check before allowing entry
4. **Test Thoroughly**: Verify all tokens work correctly

## Summary

The token whitelist system provides:

- ✅ **Security**: Only approved tokens can enter arenas
- ✅ **Control**: Admin can add/remove tokens anytime
- ✅ **Scalability**: Unlimited tokens can be added
- ✅ **Flexibility**: Tokens can be activated/deactivated
- ✅ **Gas Efficient**: Small account size per token (~50 bytes)

