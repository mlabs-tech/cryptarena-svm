use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9");

// ============================================================================
// CONSTANTS
// ============================================================================

pub const TREASURY_FEE_BPS: u64 = 1000; // 10%
pub const MIN_USD_ENTRY: u64 = 10_000_000; // $10 (6 decimals)
pub const MAX_USD_ENTRY: u64 = 20_000_000; // $20 (6 decimals)
pub const DEFAULT_ARENA_DURATION: i64 = 60; // 1 minute for testing
pub const MAX_SAME_ASSET_PER_ARENA: u8 = 3;
pub const MAX_PLAYERS_PER_ARENA: u8 = 10; // Can be increased to 100+

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod cryptarena_svm_test {
    use super::*;

    /// Initialize the protocol
    pub fn initialize(
        ctx: Context<Initialize>,
        arena_duration: i64,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.admin = ctx.accounts.admin.key();
        global_state.treasury_wallet = ctx.accounts.treasury_wallet.key();
        global_state.arena_duration = if arena_duration > 0 { arena_duration } else { DEFAULT_ARENA_DURATION };
        global_state.current_arena_id = 0;
        global_state.max_players_per_arena = MAX_PLAYERS_PER_ARENA;
        global_state.max_same_asset = MAX_SAME_ASSET_PER_ARENA;
        global_state.is_paused = false;
        global_state.bump = ctx.bumps.global_state;
        
        msg!("Cryptarena initialized. Duration: {}s, Max players: {}", 
            global_state.arena_duration, global_state.max_players_per_arena);
        Ok(())
    }

    /// Update treasury wallet (admin only)
    pub fn update_treasury_wallet(
        ctx: Context<AdminOnly>,
        new_treasury: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        ctx.accounts.global_state.treasury_wallet = new_treasury;
        msg!("Treasury updated to {}", new_treasury);
        Ok(())
    }

    /// Update max players per arena (admin only)
    pub fn update_max_players(
        ctx: Context<AdminOnly>,
        max_players: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        ctx.accounts.global_state.max_players_per_arena = max_players;
        msg!("Max players updated to {}", max_players);
        Ok(())
    }

    /// Update arena duration (admin only)
    pub fn update_arena_duration(
        ctx: Context<AdminOnly>,
        arena_duration: i64,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        require!(
            arena_duration > 0,
            CryptarenaError::InvalidDuration
        );
        ctx.accounts.global_state.arena_duration = arena_duration;
        msg!("Arena duration updated to {} seconds", arena_duration);
        Ok(())
    }

    /// Add token to whitelist (admin only)
    pub fn add_whitelisted_token(
        ctx: Context<AddWhitelistedToken>,
        asset_index: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        
        let whitelisted_token = &mut ctx.accounts.whitelisted_token;
        whitelisted_token.mint = ctx.accounts.token_mint.key();
        whitelisted_token.asset_index = asset_index;
        whitelisted_token.is_active = true;
        whitelisted_token.bump = ctx.bumps.whitelisted_token;
        
        msg!("Token {} whitelisted at index {}", ctx.accounts.token_mint.key(), asset_index);
        Ok(())
    }

    /// Remove token from whitelist (admin only)
    pub fn remove_whitelisted_token(
        ctx: Context<RemoveWhitelistedToken>,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        
        ctx.accounts.whitelisted_token.is_active = false;
        msg!("Token {} removed from whitelist", ctx.accounts.whitelisted_token.mint);
        Ok(())
    }

    /// Enter arena with tokens
    pub fn enter_arena(
        ctx: Context<EnterArena>,
        asset_index: u8,
        amount: u64,
        usd_value: u64,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        let arena = &mut ctx.accounts.arena;
        let arena_asset = &mut ctx.accounts.arena_asset;
        let clock = Clock::get()?;

        // Initialize arena if new
        if arena.status == ArenaStatus::Uninitialized as u8 {
            arena.id = global_state.current_arena_id;
            arena.status = ArenaStatus::Waiting as u8;
            arena.player_count = 0;
            arena.asset_count = 0;
            arena.total_pool = 0;
            arena.winning_asset = 255;
            arena.bump = ctx.bumps.arena;
            msg!("New arena {} created", arena.id);
        }

        require!(
            arena.status == ArenaStatus::Waiting as u8,
            CryptarenaError::ArenaNotWaiting
        );

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

        // Initialize or update arena asset
        if arena_asset.arena == Pubkey::default() {
            // New asset for this arena
            arena_asset.arena = arena.key();
            arena_asset.asset_index = asset_index;
            arena_asset.player_count = 0;
            arena_asset.start_price = 0;
            arena_asset.end_price = 0;
            arena_asset.price_movement = 0;
            arena_asset.bump = ctx.bumps.arena_asset;
            arena.asset_count += 1;
        }

        require!(
            arena_asset.player_count < global_state.max_same_asset,
            CryptarenaError::MaxAssetLimitReached
        );

        // Initialize player entry
        let player_entry = &mut ctx.accounts.player_entry;
        player_entry.arena = arena.key();
        player_entry.player = ctx.accounts.player.key();
        player_entry.asset_index = asset_index;
        player_entry.amount = amount;
        player_entry.usd_value = usd_value;
        player_entry.entry_timestamp = clock.unix_timestamp;
        player_entry.player_index = arena.player_count;
        player_entry.is_winner = false;
        player_entry.own_tokens_claimed = false;
        player_entry.treasury_fee_claimed = false;
        player_entry.rewards_claimed_bitmap = 0;
        player_entry.bump = ctx.bumps.player_entry;

        // Update counts
        arena_asset.player_count += 1;
        arena.player_count += 1;
        arena.total_pool += usd_value;

        // Transfer tokens to arena vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.arena_vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        msg!("Player {} entered arena {} | Asset: {} | Amount: {} | Players: {}/{}", 
            ctx.accounts.player.key(), arena.id, asset_index, amount,
            arena.player_count, global_state.max_players_per_arena);

        // Check if arena is full
        if arena.player_count >= global_state.max_players_per_arena {
            arena.status = ArenaStatus::Ready as u8;
            global_state.current_arena_id += 1;
            msg!("Arena {} FULL! Status: READY", arena.id);
        }

        Ok(())
    }

    /// Set start price for an asset (ADMIN ONLY)
    pub fn set_start_price(
        ctx: Context<SetPrice>,
        price: u64,
    ) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let arena_asset = &mut ctx.accounts.arena_asset;
        let global_state = &ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Ready as u8 || arena.status == ArenaStatus::Starting as u8,
            CryptarenaError::ArenaNotReady
        );

        // First price sets status to Starting
        if arena.status == ArenaStatus::Ready as u8 {
            arena.status = ArenaStatus::Starting as u8;
            arena.start_timestamp = clock.unix_timestamp;
        }

        arena_asset.start_price = price;
        arena.prices_set += 1;

        msg!("Asset {} start price: {} | Prices set: {}/{}", 
            arena_asset.asset_index, price, arena.prices_set, arena.asset_count);

        // All prices set? Activate arena
        if arena.prices_set >= arena.asset_count {
            arena.status = ArenaStatus::Active as u8;
            arena.end_timestamp = clock.unix_timestamp + global_state.arena_duration;
            msg!("Arena {} ACTIVE! Ends at {}", arena.id, arena.end_timestamp);
        }

        Ok(())
    }

    /// Set end price for an asset (ADMIN ONLY)
    pub fn set_end_price(
        ctx: Context<SetPrice>,
        price: u64,
    ) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let arena_asset = &mut ctx.accounts.arena_asset;
        let global_state = &ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Active as u8 || arena.status == ArenaStatus::Ending as u8,
            CryptarenaError::ArenaNotActive
        );

        require!(
            clock.unix_timestamp >= arena.end_timestamp,
            CryptarenaError::ArenaDurationNotComplete
        );

        // First end price sets status to Ending
        if arena.status == ArenaStatus::Active as u8 {
            arena.status = ArenaStatus::Ending as u8;
            arena.end_prices_set = 0;
        }

        arena_asset.end_price = price;
        
        // Calculate price movement (basis points)
        if arena_asset.start_price > 0 {
            let start = arena_asset.start_price as i64;
            let end = price as i64;
            arena_asset.price_movement = ((end - start) * 10000) / start;
        }
        
        arena.end_prices_set += 1;

        msg!("Asset {} end price: {} | Movement: {}bps | End prices: {}/{}", 
            arena_asset.asset_index, price, arena_asset.price_movement,
            arena.end_prices_set, arena.asset_count);

        Ok(())
    }

    /// Finalize arena and determine winner (ADMIN ONLY)
    /// Must pass all ArenaAsset accounts as remaining_accounts
    pub fn finalize_arena(ctx: Context<FinalizeArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let global_state = &ctx.accounts.global_state;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Ending as u8,
            CryptarenaError::ArenaNotEnding
        );

        require!(
            arena.end_prices_set >= arena.asset_count,
            CryptarenaError::MissingPrice
        );

        // Find winning asset from remaining_accounts
        let mut best_movement: i64 = i64::MIN;
        let mut winning_asset: u8 = 255;
        let mut tie_detected = false;

        for account_info in ctx.remaining_accounts.iter() {
            let data = account_info.try_borrow_data()?;
            // Skip discriminator (8 bytes) and check if it's an ArenaAsset
            if data.len() >= 8 + 32 + 1 + 1 + 8 + 8 + 8 + 1 {
                // Parse ArenaAsset data manually
                let asset_index = data[8 + 32]; // After discriminator + arena pubkey
                let movement_bytes: [u8; 8] = data[8 + 32 + 1 + 1 + 8 + 8..8 + 32 + 1 + 1 + 8 + 8 + 8]
                    .try_into()
                    .unwrap_or([0u8; 8]);
                let movement = i64::from_le_bytes(movement_bytes);

                msg!("Asset {} movement: {}bps", asset_index, movement);

                if movement > best_movement {
                    best_movement = movement;
                    winning_asset = asset_index;
                    tie_detected = false;
                } else if movement == best_movement && winning_asset != 255 {
                    tie_detected = true;
                }
            }
        }

        if tie_detected {
            arena.is_suspended = true;
            arena.status = ArenaStatus::Suspended as u8;
            msg!("Arena {} SUSPENDED due to tie!", arena.id);
            return Ok(());
        }

        arena.winning_asset = winning_asset;
        arena.status = ArenaStatus::Ended as u8;

        msg!("Arena {} ENDED! Winner: Asset {} with {}bps", 
            arena.id, winning_asset, best_movement);
        Ok(())
    }

    /// Winner claims their own tokens back (100%)
    pub fn claim_own_tokens(ctx: Context<ClaimOwnTokens>) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let player_entry = &mut ctx.accounts.player_entry;

        require!(
            arena.status == ArenaStatus::Ended as u8,
            CryptarenaError::ArenaNotEnded
        );

        require!(
            player_entry.asset_index == arena.winning_asset,
            CryptarenaError::NotAWinner
        );

        require!(
            !player_entry.own_tokens_claimed,
            CryptarenaError::RewardAlreadyClaimed
        );

        let amount = player_entry.amount;
        
        // Transfer from arena vault to winner
        let arena_id_bytes = arena.id.to_le_bytes();
        let seeds = &[b"arena_v2".as_ref(), arena_id_bytes.as_ref(), &[arena.bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.arena_vault.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.arena.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, amount)?;

        player_entry.own_tokens_claimed = true;
        player_entry.is_winner = true;

        msg!("Winner claimed {} own tokens", amount);
        Ok(())
    }

    /// Winner claims tokens from a loser (90% only - treasury claims separately)
    pub fn claim_loser_tokens(ctx: Context<ClaimLoserTokens>) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let winner_entry = &mut ctx.accounts.winner_entry;
        let loser_entry = &ctx.accounts.loser_entry;
        let arena_asset = &ctx.accounts.arena_asset;

        require!(
            arena.status == ArenaStatus::Ended as u8,
            CryptarenaError::ArenaNotEnded
        );

        require!(
            winner_entry.asset_index == arena.winning_asset,
            CryptarenaError::NotAWinner
        );

        // Check loser is actually a loser
        require!(
            loser_entry.asset_index != arena.winning_asset,
            CryptarenaError::CannotClaimFromWinner
        );

        // Check not already claimed using bitmap
        let loser_bit = 1u128 << loser_entry.player_index;
        require!(
            winner_entry.rewards_claimed_bitmap & loser_bit == 0,
            CryptarenaError::RewardAlreadyClaimed
        );

        // Calculate winner's share: 90% of (loser_amount / winner_count)
        let winner_count = arena_asset.player_count as u64;
        let loser_amount = loser_entry.amount;
        let amount_per_winner = loser_amount / winner_count.max(1);
        
        // Winner gets 90% (10% stays in vault for treasury)
        let treasury_fee = (amount_per_winner * TREASURY_FEE_BPS) / 10000;
        let winner_reward = amount_per_winner - treasury_fee;

        let arena_id_bytes = arena.id.to_le_bytes();
        let seeds = &[b"arena_v2".as_ref(), arena_id_bytes.as_ref(), &[arena.bump]];
        let signer = &[&seeds[..]];

        // Transfer 90% to winner (10% stays in arena vault for treasury)
        let transfer_to_winner = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.arena_vault.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.arena.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_to_winner, winner_reward)?;

        // Mark as claimed by this winner
        winner_entry.rewards_claimed_bitmap |= loser_bit;
        winner_entry.is_winner = true;

        msg!("Winner claimed {} from loser {} (treasury fee {} in vault)", 
            winner_reward, loser_entry.player_index, treasury_fee);
        Ok(())
    }

    /// Admin collects treasury fee from a loser (10%) - INDEPENDENT of winner claims
    pub fn collect_treasury_fee(ctx: Context<CollectTreasuryFee>) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );

        let arena = &ctx.accounts.arena;
        let loser_entry = &mut ctx.accounts.loser_entry;

        require!(
            arena.status == ArenaStatus::Ended as u8,
            CryptarenaError::ArenaNotEnded
        );

        // Check loser is actually a loser
        require!(
            loser_entry.asset_index != arena.winning_asset,
            CryptarenaError::CannotClaimFromWinner
        );

        // Check treasury hasn't already claimed from this loser
        require!(
            !loser_entry.treasury_fee_claimed,
            CryptarenaError::TreasuryFeeAlreadyClaimed
        );

        // Calculate treasury fee (10% of loser's tokens)
        let treasury_fee = (loser_entry.amount * TREASURY_FEE_BPS) / 10000;

        let arena_id_bytes = arena.id.to_le_bytes();
        let seeds = &[b"arena_v2".as_ref(), arena_id_bytes.as_ref(), &[arena.bump]];
        let signer = &[&seeds[..]];

        // Transfer 10% from arena vault to treasury token account
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.arena_vault.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.arena.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, treasury_fee)?;

        // Mark treasury fee as claimed for this loser
        loser_entry.treasury_fee_claimed = true;

        msg!("Treasury collected {} from loser {}", treasury_fee, loser_entry.player_index);
        Ok(())
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [b"global_state_v2"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Treasury wallet
    pub treasury_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct AddWhitelistedToken<'info> {
    #[account(seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        init,
        payer = admin,
        space = 8 + WhitelistedToken::INIT_SPACE,
        seeds = [b"whitelist_token_v2", token_mint.key().as_ref()],
        bump
    )]
    pub whitelisted_token: Account<'info, WhitelistedToken>,

    /// CHECK: Token mint address
    pub token_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveWhitelistedToken<'info> {
    #[account(seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"whitelist_token_v2", whitelisted_token.mint.as_ref()],
        bump = whitelisted_token.bump
    )]
    pub whitelisted_token: Account<'info, WhitelistedToken>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct EnterArena<'info> {
    #[account(mut, seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        init_if_needed,
        payer = player,
        space = 8 + Arena::INIT_SPACE,
        seeds = [b"arena_v2", global_state.current_arena_id.to_le_bytes().as_ref()],
        bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        init_if_needed,
        payer = player,
        space = 8 + ArenaAsset::INIT_SPACE,
        seeds = [b"arena_asset_v2", arena.key().as_ref(), &[asset_index]],
        bump
    )]
    pub arena_asset: Account<'info, ArenaAsset>,

    #[account(
        init,
        payer = player,
        space = 8 + PlayerEntry::INIT_SPACE,
        seeds = [b"player_entry_v2", arena.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub arena_vault: Account<'info, TokenAccount>,

    /// Whitelisted token account
    #[account(
        seeds = [b"whitelist_token_v2", player_token_account.mint.as_ref()],
        bump = whitelisted_token.bump
    )]
    pub whitelisted_token: Account<'info, WhitelistedToken>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut, seeds = [b"arena_v2", arena.id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"arena_asset_v2", arena.key().as_ref(), &[arena_asset.asset_index]],
        bump = arena_asset.bump
    )]
    pub arena_asset: Account<'info, ArenaAsset>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeArena<'info> {
    #[account(seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut, seeds = [b"arena_v2", arena.id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    pub admin: Signer<'info>,
    // ArenaAsset accounts passed as remaining_accounts
}

#[derive(Accounts)]
pub struct ClaimOwnTokens<'info> {
    #[account(seeds = [b"arena_v2", arena.id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"player_entry_v2", arena.key().as_ref(), winner.key().as_ref()],
        bump = player_entry.bump,
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub arena_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,

    pub winner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimLoserTokens<'info> {
    #[account(seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(seeds = [b"arena_v2", arena.id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    /// The winning asset's ArenaAsset (to get winner count)
    #[account(
        seeds = [b"arena_asset_v2", arena.key().as_ref(), &[arena.winning_asset]],
        bump = arena_asset.bump
    )]
    pub arena_asset: Account<'info, ArenaAsset>,

    #[account(
        mut,
        seeds = [b"player_entry_v2", arena.key().as_ref(), winner.key().as_ref()],
        bump = winner_entry.bump,
    )]
    pub winner_entry: Account<'info, PlayerEntry>,

    /// Loser's player entry (to get their amount)
    #[account(
        seeds = [b"player_entry_v2", arena.key().as_ref(), loser_entry.player.as_ref()],
        bump = loser_entry.bump,
    )]
    pub loser_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub arena_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,

    pub winner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CollectTreasuryFee<'info> {
    #[account(seeds = [b"global_state_v2"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(seeds = [b"arena_v2", arena.id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    /// Loser's player entry
    #[account(
        mut,
        seeds = [b"player_entry_v2", arena.key().as_ref(), loser_entry.player.as_ref()],
        bump = loser_entry.bump,
    )]
    pub loser_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub arena_vault: Account<'info, TokenAccount>,

    /// Admin/Treasury's token account to receive the fee
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ============================================================================
// STATE - All small, scalable accounts
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub admin: Pubkey,
    pub treasury_wallet: Pubkey,
    pub arena_duration: i64,
    pub current_arena_id: u64,
    pub max_players_per_arena: u8,
    pub max_same_asset: u8,
    pub is_paused: bool,
    pub bump: u8,
}

/// Arena - Lightweight metadata only (~100 bytes)
#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub id: u64,
    pub status: u8,
    pub player_count: u8,
    pub asset_count: u8,
    pub prices_set: u8,
    pub end_prices_set: u8,
    pub winning_asset: u8,
    pub is_suspended: bool,
    pub bump: u8,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub total_pool: u64,
}

/// ArenaAsset - One per asset in arena (~80 bytes)
#[account]
#[derive(InitSpace)]
pub struct ArenaAsset {
    pub arena: Pubkey,
    pub asset_index: u8,
    pub player_count: u8,
    pub start_price: u64,
    pub end_price: u64,
    pub price_movement: i64,
    pub bump: u8,
}

/// PlayerEntry - One per player (~120 bytes)
#[account]
#[derive(InitSpace)]
pub struct PlayerEntry {
    pub arena: Pubkey,
    pub player: Pubkey,
    pub asset_index: u8,
    pub player_index: u8,
    pub amount: u64,
    pub usd_value: u64,
    pub entry_timestamp: i64,
    pub is_winner: bool,
    pub own_tokens_claimed: bool,
    pub treasury_fee_claimed: bool, // True when admin collected 10% from this loser
    pub rewards_claimed_bitmap: u128, // Supports up to 128 players
    pub bump: u8,
}

/// WhitelistedToken - Tokens allowed to enter arenas (~50 bytes)
#[account]
#[derive(InitSpace)]
pub struct WhitelistedToken {
    pub mint: Pubkey,
    pub asset_index: u8,
    pub is_active: bool,
    pub bump: u8,
}


// ============================================================================
// ENUMS & ERRORS
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArenaStatus {
    Uninitialized = 0,
    Waiting = 1,
    Ready = 2,
    Active = 3,
    Ended = 4,
    Suspended = 5,
    Starting = 6,
    Ending = 7,
}

#[error_code]
pub enum CryptarenaError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Invalid asset index")]
    InvalidAsset,
    #[msg("Arena is not in waiting status")]
    ArenaNotWaiting,
    #[msg("Arena is not ready")]
    ArenaNotReady,
    #[msg("Arena is not active")]
    ArenaNotActive,
    #[msg("Arena has not ended")]
    ArenaNotEnded,
    #[msg("Arena duration not complete")]
    ArenaDurationNotComplete,
    #[msg("Max same asset per arena reached")]
    MaxAssetLimitReached,
    #[msg("Not a winner")]
    NotAWinner,
    #[msg("Reward already claimed")]
    RewardAlreadyClaimed,
    #[msg("Missing price")]
    MissingPrice,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arena is not in ending state")]
    ArenaNotEnding,
    #[msg("Cannot claim from another winner")]
    CannotClaimFromWinner,
    #[msg("Invalid duration - must be greater than 0")]
    InvalidDuration,
    #[msg("Token is not whitelisted")]
    TokenNotWhitelisted,
    #[msg("Asset index does not match whitelisted token")]
    InvalidAssetIndex,
    #[msg("Treasury fee already claimed from this loser")]
    TreasuryFeeAlreadyClaimed,
}
