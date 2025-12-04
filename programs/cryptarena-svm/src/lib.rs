use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("GjiVESbCveUyk2c1zqbFCzPnuficii3L5ZJHgYHMRhg6");

// ============================================================================
// CONSTANTS
// ============================================================================

pub const MAX_PLAYERS_PER_ARENA: usize = 10;
pub const MAX_SAME_ASSET_PER_ARENA: u8 = 3;
pub const MIN_ENTRY_USD: u64 = 10_000_000; // $10 with 6 decimals
pub const MAX_ENTRY_USD: u64 = 20_000_000; // $20 with 6 decimals
pub const TREASURY_FEE_BPS: u64 = 1000; // 10%
pub const DEFAULT_ARENA_DURATION: i64 = 600; // 10 minutes in seconds
pub const PYTH_PRICE_MAX_AGE: u64 = 60; // 60 seconds

// Asset indices
pub const ASSET_SOL: u8 = 0;
pub const ASSET_TRUMP: u8 = 1;
pub const ASSET_PUMP: u8 = 2;
pub const ASSET_BONK: u8 = 3;
pub const ASSET_JUP: u8 = 4;
pub const ASSET_PENGU: u8 = 5;
pub const ASSET_PYTH: u8 = 6;
pub const ASSET_HNT: u8 = 7;
pub const ASSET_FARTCOIN: u8 = 8;
pub const ASSET_RAY: u8 = 9;
pub const ASSET_JTO: u8 = 10;
pub const ASSET_KMNO: u8 = 11;
pub const ASSET_MET: u8 = 12;
pub const ASSET_W: u8 = 13;
pub const TOTAL_ASSETS: usize = 14;

// Pyth Price Feed IDs (as bytes for on-chain storage)
pub const PYTH_FEED_SOL: [u8; 32] = hex_to_bytes("de87506dabfadbef89af2d5d796ebae80ddaea240fc7667aa808fce3629cd8fb");
pub const PYTH_FEED_TRUMP: [u8; 32] = hex_to_bytes("879551021853eec7a7dc827578e8e69da7e4fa8148339aa0d3d5296405be4b1a");
pub const PYTH_FEED_PUMP: [u8; 32] = hex_to_bytes("7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9");
pub const PYTH_FEED_BONK: [u8; 32] = hex_to_bytes("72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419");
pub const PYTH_FEED_JUP: [u8; 32] = hex_to_bytes("0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996");
pub const PYTH_FEED_PENGU: [u8; 32] = hex_to_bytes("bed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61");
pub const PYTH_FEED_PYTH: [u8; 32] = hex_to_bytes("0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff");
pub const PYTH_FEED_HNT: [u8; 32] = hex_to_bytes("649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756");
pub const PYTH_FEED_FARTCOIN: [u8; 32] = hex_to_bytes("058cd29ef0e714c5affc44f269b2c1899a52da416d7acc147b9da692e6953608");
pub const PYTH_FEED_RAY: [u8; 32] = hex_to_bytes("91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a");
pub const PYTH_FEED_JTO: [u8; 32] = hex_to_bytes("b43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2");
pub const PYTH_FEED_KMNO: [u8; 32] = hex_to_bytes("b17e5bc5de742a8a378b54c9c75442b7d51e30ada63f28d9bd28d3c0e26511a0");
pub const PYTH_FEED_MET: [u8; 32] = hex_to_bytes("0292e0f405bcd4a496d34e48307f6787349ad2bcd8505c3d3a9f77d81a67a682");
pub const PYTH_FEED_W: [u8; 32] = hex_to_bytes("eff7446475e218517566ea99e72a4abec2e1bd8498b43b7d8331e29dcb059389");

/// Convert hex string to bytes at compile time
const fn hex_to_bytes(hex: &str) -> [u8; 32] {
    let bytes = hex.as_bytes();
    let mut result = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        let high = hex_char_to_nibble(bytes[i * 2]);
        let low = hex_char_to_nibble(bytes[i * 2 + 1]);
        result[i] = (high << 4) | low;
        i += 1;
    }
    result
}

const fn hex_char_to_nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => 0,
    }
}

/// Get Pyth feed ID for an asset index
pub fn get_pyth_feed_id(asset_index: u8) -> [u8; 32] {
    match asset_index {
        ASSET_SOL => PYTH_FEED_SOL,
        ASSET_TRUMP => PYTH_FEED_TRUMP,
        ASSET_PUMP => PYTH_FEED_PUMP,
        ASSET_BONK => PYTH_FEED_BONK,
        ASSET_JUP => PYTH_FEED_JUP,
        ASSET_PENGU => PYTH_FEED_PENGU,
        ASSET_PYTH => PYTH_FEED_PYTH,
        ASSET_HNT => PYTH_FEED_HNT,
        ASSET_FARTCOIN => PYTH_FEED_FARTCOIN,
        ASSET_RAY => PYTH_FEED_RAY,
        ASSET_JTO => PYTH_FEED_JTO,
        ASSET_KMNO => PYTH_FEED_KMNO,
        ASSET_MET => PYTH_FEED_MET,
        ASSET_W => PYTH_FEED_W,
        _ => [0u8; 32],
    }
}

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod cryptarena_svm {
    use super::*;

    /// Initialize the global state for the protocol
    pub fn initialize(ctx: Context<Initialize>, arena_duration: i64) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.admin = ctx.accounts.admin.key();
        global_state.treasury = ctx.accounts.treasury.key();
        global_state.arena_duration = if arena_duration > 0 { arena_duration } else { DEFAULT_ARENA_DURATION };
        global_state.current_arena_id = 0;
        global_state.waiting_arena = None;
        global_state.is_paused = false;
        global_state.bump = ctx.bumps.global_state;

        msg!("Cryptarena protocol initialized");
        Ok(())
    }

    /// Update admin settings
    pub fn update_settings(
        ctx: Context<UpdateSettings>,
        new_arena_duration: Option<i64>,
        new_treasury: Option<Pubkey>,
        is_paused: Option<bool>,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;

        if let Some(duration) = new_arena_duration {
            require!(duration > 0, CryptarenaError::InvalidDuration);
            global_state.arena_duration = duration;
        }

        if let Some(treasury) = new_treasury {
            global_state.treasury = treasury;
        }

        if let Some(paused) = is_paused {
            global_state.is_paused = paused;
        }

        msg!("Settings updated");
        Ok(())
    }

    /// Enter an arena with a selected asset
    pub fn enter_arena(
        ctx: Context<EnterArena>,
        asset_index: u8,
        amount: u64,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        // Validate protocol is not paused
        require!(!global_state.is_paused, CryptarenaError::ProtocolPaused);

        // Validate asset index
        require!(asset_index < TOTAL_ASSETS as u8, CryptarenaError::InvalidAsset);

        // Get price from Pyth oracle
        let price_update = &ctx.accounts.price_update;
        let expected_feed_id = get_pyth_feed_id(asset_index);
        let price = price_update.get_price_no_older_than(
            &Clock::get()?,
            PYTH_PRICE_MAX_AGE,
            &expected_feed_id,
        )?;

        // Calculate USD value of entry
        let price_value = price.price as u64;
        let expo = price.exponent;
        let usd_value = calculate_usd_value(amount, price_value, expo)?;

        // Validate entry amount is within bounds ($10-$20)
        require!(
            usd_value >= MIN_ENTRY_USD && usd_value <= MAX_ENTRY_USD,
            CryptarenaError::InvalidEntryAmount
        );

        // Get or create arena
        let arena = &mut ctx.accounts.arena;
        
        if arena.status == ArenaStatus::Uninitialized as u8 {
            // Initialize new arena
            arena.id = global_state.current_arena_id;
            arena.status = ArenaStatus::Waiting as u8;
            arena.player_count = 0;
            arena.asset_counts = [0u8; TOTAL_ASSETS];
            arena.start_timestamp = 0;
            arena.end_timestamp = 0;
            arena.total_pool = 0;
            arena.winning_asset = 255; // Invalid/unset
            arena.is_suspended = false;
            arena.bump = ctx.bumps.arena;

            global_state.waiting_arena = Some(arena.key());
            global_state.current_arena_id += 1;
        }

        // Validate arena is in waiting status
        require!(
            arena.status == ArenaStatus::Waiting as u8,
            CryptarenaError::ArenaNotWaiting
        );

        // Check if max same asset limit reached
        require!(
            arena.asset_counts[asset_index as usize] < MAX_SAME_ASSET_PER_ARENA,
            CryptarenaError::MaxAssetLimitReached
        );

        // Initialize player entry
        let player_entry = &mut ctx.accounts.player_entry;
        player_entry.arena = arena.key();
        player_entry.player = ctx.accounts.player.key();
        player_entry.asset_index = asset_index;
        player_entry.amount = amount;
        player_entry.usd_value = usd_value;
        player_entry.entry_price = price_value;
        player_entry.entry_timestamp = clock.unix_timestamp;
        player_entry.is_winner = false;
        player_entry.reward_claimed = false;
        player_entry.bump = ctx.bumps.player_entry;

        // Update arena state
        let player_count = arena.player_count as usize;
        arena.players[player_count] = ctx.accounts.player.key();
        arena.asset_counts[asset_index as usize] += 1;
        arena.player_count += 1;
        arena.total_pool += usd_value;

        // Store starting price for this asset if not already stored
        if arena.start_prices[asset_index as usize] == 0 {
            arena.start_prices[asset_index as usize] = price_value;
        }

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

        msg!("Player {} entered arena {} with asset {}", 
            ctx.accounts.player.key(), arena.id, asset_index);

        // Check if arena is full and should start
        if arena.player_count == MAX_PLAYERS_PER_ARENA as u8 {
            arena.status = ArenaStatus::Active as u8;
            arena.start_timestamp = clock.unix_timestamp;
            arena.end_timestamp = clock.unix_timestamp + global_state.arena_duration;
            global_state.waiting_arena = None;

            msg!("Arena {} started! Ends at {}", arena.id, arena.end_timestamp);
        }

        Ok(())
    }

    /// End an arena and determine winners (bullish mode - highest positive movement wins)
    pub fn end_arena(ctx: Context<EndArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let clock = Clock::get()?;

        // Validate arena is active and duration has passed
        require!(
            arena.status == ArenaStatus::Active as u8,
            CryptarenaError::ArenaNotActive
        );
        require!(
            clock.unix_timestamp >= arena.end_timestamp,
            CryptarenaError::ArenaDurationNotComplete
        );

        // Process each unique asset in the arena
        let mut best_movement: i64 = i64::MIN;
        let mut winning_asset: u8 = 255;
        let mut tie_detected = false;

        for asset_idx in 0..TOTAL_ASSETS {
            if arena.asset_counts[asset_idx] > 0 {
                let start_price = arena.start_prices[asset_idx] as i64;
                let end_price = arena.end_prices[asset_idx] as i64;

                if start_price > 0 && end_price > 0 {
                    // Calculate percentage movement (scaled by 10000 for precision)
                    let movement = ((end_price - start_price) * 10000) / start_price;
                    arena.price_movements[asset_idx] = movement;

                    if movement > best_movement {
                        best_movement = movement;
                        winning_asset = asset_idx as u8;
                        tie_detected = false;
                    } else if movement == best_movement && winning_asset != 255 {
                        tie_detected = true;
                    }
                }
            }
        }

        // Handle tie - suspend arena for withdrawals
        if tie_detected {
            arena.is_suspended = true;
            arena.status = ArenaStatus::Suspended as u8;
            msg!("Arena {} suspended due to tie", arena.id);
            return Ok(());
        }

        arena.winning_asset = winning_asset;
        arena.status = ArenaStatus::Ended as u8;

        msg!("Arena {} ended. Winning asset: {}, Movement: {}bps", 
            arena.id, winning_asset, best_movement);

        Ok(())
    }

    /// Update end prices for arena resolution (called before end_arena)
    pub fn update_end_prices(
        ctx: Context<UpdateEndPrices>,
        asset_index: u8,
    ) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let price_update = &ctx.accounts.price_update;
        let clock = Clock::get()?;

        require!(
            arena.status == ArenaStatus::Active as u8,
            CryptarenaError::ArenaNotActive
        );
        require!(
            clock.unix_timestamp >= arena.end_timestamp,
            CryptarenaError::ArenaDurationNotComplete
        );
        require!(asset_index < TOTAL_ASSETS as u8, CryptarenaError::InvalidAsset);
        require!(
            arena.asset_counts[asset_index as usize] > 0,
            CryptarenaError::AssetNotInArena
        );

        let expected_feed_id = get_pyth_feed_id(asset_index);
        let price = price_update.get_price_no_older_than(
            &clock,
            PYTH_PRICE_MAX_AGE,
            &expected_feed_id,
        )?;

        arena.end_prices[asset_index as usize] = price.price as u64;

        msg!("Updated end price for asset {}: {}", asset_index, price.price);
        Ok(())
    }

    /// Claim rewards for a winning player
    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let player_entry = &mut ctx.accounts.player_entry;

        // Validate arena is ended
        require!(
            arena.status == ArenaStatus::Ended as u8,
            CryptarenaError::ArenaNotEnded
        );

        // Validate player selected winning asset
        require!(
            player_entry.asset_index == arena.winning_asset,
            CryptarenaError::NotAWinner
        );

        // Validate reward not already claimed
        require!(
            !player_entry.reward_claimed,
            CryptarenaError::RewardAlreadyClaimed
        );

        // Get winner count from asset_counts
        let winner_count = arena.asset_counts[arena.winning_asset as usize];

        // Calculate player's share
        let total_pool = arena.total_pool;
        let treasury_fee = (total_pool * TREASURY_FEE_BPS) / 10000;
        let winner_pool = total_pool - treasury_fee;

        let player_reward = if winner_count == 1 {
            winner_pool
        } else {
            // Proportional distribution based on entry value
            // For now, equal split among winners
            winner_pool / winner_count as u64
        };

        // Credit to user vault
        let user_vault = &mut ctx.accounts.user_vault;
        user_vault.available_balance += player_reward;

        player_entry.is_winner = true;
        player_entry.reward_claimed = true;

        msg!("Player {} claimed reward of {} from arena {}", 
            player_entry.player, player_reward, arena.id);

        Ok(())
    }

    /// Withdraw from suspended arena (tie scenario)
    pub fn withdraw_suspended(ctx: Context<WithdrawSuspended>) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let player_entry = &mut ctx.accounts.player_entry;

        require!(
            arena.status == ArenaStatus::Suspended as u8,
            CryptarenaError::ArenaNotSuspended
        );
        require!(
            !player_entry.reward_claimed,
            CryptarenaError::AlreadyWithdrawn
        );

        // Return original entry to user vault
        let user_vault = &mut ctx.accounts.user_vault;
        user_vault.available_balance += player_entry.usd_value;
        player_entry.reward_claimed = true;

        msg!("Player {} withdrew {} from suspended arena {}", 
            player_entry.player, player_entry.usd_value, arena.id);

        Ok(())
    }

    /// Initialize user vault
    pub fn init_user_vault(ctx: Context<InitUserVault>) -> Result<()> {
        let user_vault = &mut ctx.accounts.user_vault;
        user_vault.owner = ctx.accounts.user.key();
        user_vault.available_balance = 0;
        user_vault.bump = ctx.bumps.user_vault;

        msg!("User vault initialized for {}", ctx.accounts.user.key());
        Ok(())
    }

    /// Withdraw from user vault
    pub fn withdraw_from_vault(
        ctx: Context<WithdrawFromVault>,
        amount: u64,
    ) -> Result<()> {
        let user_vault = &mut ctx.accounts.user_vault;

        require!(
            user_vault.available_balance >= amount,
            CryptarenaError::InsufficientBalance
        );

        user_vault.available_balance -= amount;

        // Transfer tokens from protocol vault to user
        let global_state = &ctx.accounts.global_state;
        let seeds = &[
            b"global_state".as_ref(),
            &[global_state.bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.protocol_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.global_state.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, amount)?;

        msg!("User {} withdrew {} from vault", ctx.accounts.user.key(), amount);
        Ok(())
    }

    /// Transfer treasury funds (admin only)
    pub fn transfer_treasury(
        ctx: Context<TransferTreasury>,
        amount: u64,
    ) -> Result<()> {
        let global_state = &ctx.accounts.global_state;
        let seeds = &[
            b"global_state".as_ref(),
            &[global_state.bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury_vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.global_state.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, amount)?;

        msg!("Treasury transfer: {} to {}", amount, ctx.accounts.destination.key());
        Ok(())
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn calculate_usd_value(amount: u64, price: u64, expo: i32) -> Result<u64> {
    // Pyth prices have variable exponents, normalize to 6 decimals (USD cents * 10000)
    let amount_u128 = amount as u128;
    let price_u128 = price as u128;
    
    // Adjust for exponent
    let usd_value = if expo < 0 {
        let divisor = 10u128.pow((-expo) as u32);
        (amount_u128 * price_u128) / divisor
    } else {
        let multiplier = 10u128.pow(expo as u32);
        amount_u128 * price_u128 * multiplier
    };

    // Scale to 6 decimals
    Ok((usd_value / 1_000_000_000_000) as u64)
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
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,
    
    /// CHECK: Treasury wallet address
    pub treasury: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSettings<'info> {
    #[account(
        mut,
        seeds = [b"global_state"],
        bump = global_state.bump,
        has_one = admin
    )]
    pub global_state: Account<'info, GlobalState>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8, amount: u64)]
pub struct EnterArena<'info> {
    #[account(
        mut,
        seeds = [b"global_state"],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        init_if_needed,
        payer = player,
        space = 8 + Arena::INIT_SPACE,
        seeds = [b"arena", global_state.current_arena_id.to_le_bytes().as_ref()],
        bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        init,
        payer = player,
        space = 8 + PlayerEntry::INIT_SPACE,
        seeds = [b"player_entry", arena.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub player: Signer<'info>,

    #[account(mut)]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"arena_vault", arena.key().as_ref()],
        bump
    )]
    pub arena_vault: Account<'info, TokenAccount>,

    pub price_update: Account<'info, PriceUpdateV2>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndArena<'info> {
    #[account(
        mut,
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    /// CHECK: Anyone can call end_arena after duration
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct UpdateEndPrices<'info> {
    #[account(
        mut,
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    pub price_update: Account<'info, PriceUpdateV2>,

    /// CHECK: Anyone can update prices
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(
        seeds = [b"global_state"],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"player_entry", arena.key().as_ref(), player.key().as_ref()],
        bump = player_entry.bump,
        has_one = player
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(
        mut,
        seeds = [b"user_vault", player.key().as_ref()],
        bump = user_vault.bump
    )]
    pub user_vault: Account<'info, UserVault>,

    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawSuspended<'info> {
    #[account(
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"player_entry", arena.key().as_ref(), player.key().as_ref()],
        bump = player_entry.bump,
        has_one = player
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(
        mut,
        seeds = [b"user_vault", player.key().as_ref()],
        bump = user_vault.bump
    )]
    pub user_vault: Account<'info, UserVault>,

    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitUserVault<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserVault::INIT_SPACE,
        seeds = [b"user_vault", user.key().as_ref()],
        bump
    )]
    pub user_vault: Account<'info, UserVault>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFromVault<'info> {
    #[account(
        seeds = [b"global_state"],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"user_vault", user.key().as_ref()],
        bump = user_vault.bump,
        constraint = user_vault.owner == user.key() @ CryptarenaError::Unauthorized
    )]
    pub user_vault: Account<'info, UserVault>,

    #[account(mut)]
    pub protocol_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferTreasury<'info> {
    #[account(
        seeds = [b"global_state"],
        bump = global_state.bump,
        has_one = admin
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut)]
    pub treasury_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub arena_duration: i64,
    pub current_arena_id: u64,
    pub waiting_arena: Option<Pubkey>,
    pub is_paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub id: u64,
    pub status: u8,
    pub player_count: u8,
    #[max_len(10)]
    pub players: [Pubkey; MAX_PLAYERS_PER_ARENA],
    pub asset_counts: [u8; TOTAL_ASSETS],
    pub start_prices: [u64; TOTAL_ASSETS],
    pub end_prices: [u64; TOTAL_ASSETS],
    pub price_movements: [i64; TOTAL_ASSETS],
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub total_pool: u64,
    pub winning_asset: u8,
    pub is_suspended: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerEntry {
    pub arena: Pubkey,
    pub player: Pubkey,
    pub asset_index: u8,
    pub amount: u64,
    pub usd_value: u64,
    pub entry_price: u64,
    pub entry_timestamp: i64,
    pub is_winner: bool,
    pub reward_claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserVault {
    pub owner: Pubkey,
    pub available_balance: u64,
    pub bump: u8,
}

// ============================================================================
// ENUMS
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArenaStatus {
    Uninitialized = 0,
    Waiting = 1,
    Active = 2,
    Ended = 3,
    Suspended = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArenaType {
    Bullish = 0,
    Bearish = 1,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum CryptarenaError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Invalid asset selection")]
    InvalidAsset,
    #[msg("Entry amount must be between $10 and $20")]
    InvalidEntryAmount,
    #[msg("Maximum 3 players with same asset per arena")]
    MaxAssetLimitReached,
    #[msg("Arena is not in waiting status")]
    ArenaNotWaiting,
    #[msg("Arena is not active")]
    ArenaNotActive,
    #[msg("Arena duration has not completed")]
    ArenaDurationNotComplete,
    #[msg("Arena has not ended")]
    ArenaNotEnded,
    #[msg("Arena is not suspended")]
    ArenaNotSuspended,
    #[msg("Player did not select winning asset")]
    NotAWinner,
    #[msg("Reward already claimed")]
    RewardAlreadyClaimed,
    #[msg("Already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Insufficient balance in vault")]
    InsufficientBalance,
    #[msg("Invalid arena duration")]
    InvalidDuration,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Asset not represented in arena")]
    AssetNotInArena,
}
