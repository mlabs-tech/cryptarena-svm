use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("J1HvjpKh1tUQQFJ3Fm5ZM7h4GSrvivdWTwzQ3UALfT9T");

// ============================================================================
// CONSTANTS
// ============================================================================

pub const TREASURY_FEE_BPS: u64 = 1000; // 10%
pub const WINNER_SHARE_BPS: u64 = 9000; // 90%
pub const DEFAULT_ENTRY_FEE: u64 = 50_000_000; // 0.05 SOL in lamports
pub const DEFAULT_ARENA_DURATION: i64 = 180; // 3 minutes for testing
pub const MIN_ARENA_DURATION: i64 = 180; // 3 minutes minimum
pub const MIN_PLAYERS_PER_ARENA: u8 = 1;
pub const MAX_PLAYERS_PER_ARENA: u8 = 10;

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod cryptarena_sol_test {
    use super::*;

    /// Initialize the protocol
    pub fn initialize(
        ctx: Context<Initialize>,
        arena_duration: i64,
        entry_fee: u64,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.admin = ctx.accounts.admin.key();
        global_state.treasury_wallet = ctx.accounts.treasury_wallet.key();
        global_state.arena_duration = if arena_duration >= MIN_ARENA_DURATION { 
            arena_duration 
        } else { 
            DEFAULT_ARENA_DURATION 
        };
        global_state.entry_fee = if entry_fee > 0 { entry_fee } else { DEFAULT_ENTRY_FEE };
        global_state.current_arena_id = 0;
        global_state.is_paused = false;
        global_state.bump = ctx.bumps.global_state;
        
        msg!("Cryptarena SOL initialized. Duration: {}s, Entry Fee: {} lamports", 
            global_state.arena_duration, global_state.entry_fee);
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

    /// Update arena duration (admin only) - minimum 10 minutes
    pub fn update_arena_duration(
        ctx: Context<AdminOnly>,
        arena_duration: i64,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        require!(
            arena_duration >= MIN_ARENA_DURATION,
            CryptarenaError::InvalidDuration
        );
        ctx.accounts.global_state.arena_duration = arena_duration;
        msg!("Arena duration updated to {} seconds", arena_duration);
        Ok(())
    }

    /// Update entry fee (admin only)
    pub fn update_entry_fee(
        ctx: Context<AdminOnly>,
        entry_fee: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        require!(
            entry_fee > 0,
            CryptarenaError::InvalidEntryFee
        );
        ctx.accounts.global_state.entry_fee = entry_fee;
        msg!("Entry fee updated to {} lamports ({} SOL)", entry_fee, entry_fee as f64 / 1_000_000_000.0);
        Ok(())
    }

    /// Pause/unpause the protocol (admin only)
    pub fn set_paused(
        ctx: Context<AdminOnly>,
        paused: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        ctx.accounts.global_state.is_paused = paused;
        msg!("Protocol paused: {}", paused);
        Ok(())
    }

    /// Add token to whitelist (admin only)
    /// chain_type: 0 = Solana, 1 = EVM (Ethereum)
    /// token_address: 32 bytes for Solana, 20 bytes (left-padded to 32) for EVM
    /// symbol: up to 10 bytes for token symbol
    pub fn add_whitelisted_token(
        ctx: Context<AddWhitelistedToken>,
        asset_index: u8,
        chain_type: u8,
        token_address: [u8; 32],
        symbol: [u8; 10],
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        
        require!(
            chain_type <= 1,
            CryptarenaError::InvalidChainType
        );
        
        let whitelisted_token = &mut ctx.accounts.whitelisted_token;
        whitelisted_token.asset_index = asset_index;
        whitelisted_token.chain_type = chain_type;
        whitelisted_token.token_address = token_address;
        whitelisted_token.symbol = symbol;
        whitelisted_token.is_active = true;
        whitelisted_token.bump = ctx.bumps.whitelisted_token;
        
        msg!("Token whitelisted at index {} | Chain: {} | Symbol: {:?}", 
            asset_index, chain_type, symbol);
        Ok(())
    }

    /// Remove token from whitelist (admin only)
    pub fn remove_whitelisted_token(
        ctx: Context<RemoveWhitelistedToken>,
        asset_index: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );
        
        ctx.accounts.whitelisted_token.is_active = false;
        msg!("Token at index {} removed from whitelist", asset_index);
        Ok(())
    }

    /// Enter arena with SOL - each player picks a unique token
    /// Auto-creates new arena if none exists or current is full/started
    pub fn enter_arena(
        ctx: Context<EnterArena>,
        asset_index: u8,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        let arena = &mut ctx.accounts.arena;
        let arena_vault = &mut ctx.accounts.arena_vault;
        let clock = Clock::get()?;

        require!(
            !global_state.is_paused,
            CryptarenaError::ProtocolPaused
        );

        // Initialize arena if new (first player creates it)
        if arena.status == ArenaStatus::Uninitialized as u8 {
            arena.id = global_state.current_arena_id;
            arena.status = ArenaStatus::Waiting as u8;
            arena.player_count = 0;
            arena.total_pool = 0;
            arena.winning_asset = 255;
            arena.is_canceled = false;
            arena.treasury_claimed = false;
            arena.bump = ctx.bumps.arena;
            arena.start_timestamp = 0;
            arena.end_timestamp = 0;
            arena.token_slots = [255u8; 10];
            arena.player_addresses = [Pubkey::default(); 10];
            
            // Initialize arena vault
            arena_vault.arena_id = global_state.current_arena_id;
            arena_vault.bump = ctx.bumps.arena_vault;
            
            msg!("New arena {} created", arena.id);
        }

        require!(
            arena.status == ArenaStatus::Waiting as u8,
            CryptarenaError::ArenaNotWaiting
        );

        require!(
            arena.player_count < MAX_PLAYERS_PER_ARENA,
            CryptarenaError::ArenaFull
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

        // Check token is not already taken in this arena
        for i in 0..arena.player_count as usize {
            require!(
                arena.token_slots[i] != asset_index,
                CryptarenaError::TokenAlreadyTaken
            );
        }

        // Transfer SOL entry fee to arena vault PDA
        let entry_fee = global_state.entry_fee;
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.arena_vault.to_account_info(),
            },
        );
        transfer(transfer_ctx, entry_fee)?;

        // Initialize player entry
        let player_entry = &mut ctx.accounts.player_entry;
        player_entry.arena = arena.key();
        player_entry.player = ctx.accounts.player.key();
        player_entry.asset_index = asset_index;
        player_entry.entry_fee = entry_fee;
        player_entry.entry_timestamp = clock.unix_timestamp;
        player_entry.player_index = arena.player_count;
        player_entry.is_winner = false;
        player_entry.has_claimed = false;
        player_entry.start_price = 0;
        player_entry.end_price = 0;
        player_entry.price_movement = 0;
        player_entry.bump = ctx.bumps.player_entry;

        // Update arena state
        let player_idx = arena.player_count as usize;
        arena.token_slots[player_idx] = asset_index;
        arena.player_addresses[player_idx] = ctx.accounts.player.key();
        arena.player_count += 1;
        arena.total_pool += entry_fee;

        msg!("Player {} entered arena {} | Token: {} | Entry Fee: {} | Players: {}/{}", 
            ctx.accounts.player.key(), arena.id, asset_index, entry_fee,
            arena.player_count, MAX_PLAYERS_PER_ARENA);

        // If arena is now full (10 players), increment arena ID so next player creates new arena
        if arena.player_count >= MAX_PLAYERS_PER_ARENA {
            global_state.current_arena_id += 1;
            msg!("Arena {} is FULL! Next player will create arena {}", arena.id, global_state.current_arena_id);
        }

        Ok(())
    }

    /// Start arena (ADMIN ONLY) - requires at least 1 player
    /// After starting, increments arena ID so next player creates new arena
    pub fn start_arena(ctx: Context<StartArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Waiting as u8,
            CryptarenaError::ArenaNotWaiting
        );

        require!(
            arena.player_count >= MIN_PLAYERS_PER_ARENA,
            CryptarenaError::NotEnoughPlayers
        );

        arena.status = ArenaStatus::Active as u8;
        arena.start_timestamp = clock.unix_timestamp;
        arena.end_timestamp = clock.unix_timestamp + global_state.arena_duration;

        // Increment arena ID so next player entering creates a new arena
        global_state.current_arena_id += 1;

        msg!("Arena {} STARTED! {} players | Ends at {}", 
            arena.id, arena.player_count, arena.end_timestamp);

        Ok(())
    }

    /// Set start price for a player's token (ADMIN ONLY)
    pub fn set_start_price(
        ctx: Context<SetPlayerPrice>,
        price: u64,
    ) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let player_entry = &mut ctx.accounts.player_entry;
        let global_state = &ctx.accounts.global_state;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Active as u8,
            CryptarenaError::ArenaNotActive
        );

        player_entry.start_price = price;

        msg!("Player {} token {} start price: {}", 
            player_entry.player_index, player_entry.asset_index, price);

        Ok(())
    }

    /// Set end price for a player's token (ADMIN ONLY)
    pub fn set_end_price(
        ctx: Context<SetPlayerPrice>,
        price: u64,
    ) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let player_entry = &mut ctx.accounts.player_entry;
        let global_state = &ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Active as u8,
            CryptarenaError::ArenaNotActive
        );

        // Must be after arena duration has passed
        require!(
            clock.unix_timestamp >= arena.end_timestamp,
            CryptarenaError::ArenaDurationNotComplete
        );

        player_entry.end_price = price;
        
        // Calculate price movement with 12 decimal precision (10^12 multiplier)
        // This gives us 0.000000000001% precision, essential for very small price tokens (PEPE, SHIB, etc.)
        // Use i128 for intermediate calculation to avoid overflow
        if player_entry.start_price > 0 {
            let start = player_entry.start_price as i128;
            let end = price as i128;
            // Multiplier: 10^12 for 12 decimal places (e.g., 837900000000 = 0.8379%)
            let movement = ((end - start) * 1_000_000_000_000) / start;
            player_entry.price_movement = movement as i64;
        }

        msg!("Player {} token {} end price: {} | Movement: {} (12 decimals)", 
            player_entry.player_index, player_entry.asset_index, 
            price, player_entry.price_movement);

        Ok(())
    }

    /// End arena and determine winner (ADMIN ONLY)
    /// Must pass all PlayerEntry accounts as remaining_accounts
    pub fn end_arena(ctx: Context<EndArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let global_state = &ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(
            ctx.accounts.admin.key() == global_state.admin,
            CryptarenaError::Unauthorized
        );

        require!(
            arena.status == ArenaStatus::Active as u8,
            CryptarenaError::ArenaNotActive
        );

        // Must be after arena duration has passed
        require!(
            clock.unix_timestamp >= arena.end_timestamp,
            CryptarenaError::ArenaDurationNotComplete
        );

        // Find winning player from remaining_accounts
        let mut best_movement: i64 = i64::MIN;
        let mut winning_asset: u8 = 255;
        let mut tie_detected = false;
        let mut prices_set_count = 0;

        for account_info in ctx.remaining_accounts.iter() {
            let data = account_info.try_borrow_data()?;
            // Skip discriminator (8 bytes) and parse PlayerEntry
            // PlayerEntry layout: arena(32) + player(32) + asset_index(1) + player_index(1) + 
            //                     entry_fee(8) + entry_timestamp(8) + start_price(8) + end_price(8) + 
            //                     price_movement(8) + is_winner(1) + has_claimed(1) + bump(1)
            if data.len() >= 8 + 32 + 32 + 1 + 1 + 8 + 8 + 8 + 8 + 8 {
                let asset_index = data[8 + 32 + 32]; // After discriminator + arena + player
                
                // Read start_price and end_price
                let start_price_offset = 8 + 32 + 32 + 1 + 1 + 8 + 8;
                let end_price_offset = start_price_offset + 8;
                let movement_offset = end_price_offset + 8;
                
                let start_price_bytes: [u8; 8] = data[start_price_offset..start_price_offset + 8]
                    .try_into()
                    .unwrap_or([0u8; 8]);
                let end_price_bytes: [u8; 8] = data[end_price_offset..end_price_offset + 8]
                    .try_into()
                    .unwrap_or([0u8; 8]);
                let movement_bytes: [u8; 8] = data[movement_offset..movement_offset + 8]
                    .try_into()
                    .unwrap_or([0u8; 8]);
                    
                let start_price = u64::from_le_bytes(start_price_bytes);
                let end_price = u64::from_le_bytes(end_price_bytes);
                let movement = i64::from_le_bytes(movement_bytes);

                // Verify prices are set
                if start_price > 0 && end_price > 0 {
                    prices_set_count += 1;
                    
                    msg!("Player token {} movement: {} (12 decimals)", asset_index, movement);

                    if movement > best_movement {
                        best_movement = movement;
                        winning_asset = asset_index;
                        tie_detected = false;
                    } else if movement == best_movement && winning_asset != 255 {
                        tie_detected = true;
                    }
                }
            }
        }

        // Ensure all players have prices set
        require!(
            prices_set_count == arena.player_count,
            CryptarenaError::MissingPrice
        );

        if tie_detected {
            // Cancel arena - users can claim back their SOL
            arena.is_canceled = true;
            arena.status = ArenaStatus::Canceled as u8;
            msg!("Arena {} CANCELED due to tie! Users can claim refunds.", arena.id);
            return Ok(());
        }

        arena.winning_asset = winning_asset;
        arena.status = ArenaStatus::Ended as u8;

        msg!("Arena {} ENDED! Winner token: {} with {} (8 decimals)", 
            arena.id, winning_asset, best_movement);
        Ok(())
    }

    /// Winner claims rewards (100% for single-player arenas, 90% for multi-player arenas)
    pub fn claim_winner_rewards(ctx: Context<ClaimWinnerRewards>) -> Result<()> {
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
            !player_entry.has_claimed,
            CryptarenaError::RewardAlreadyClaimed
        );

        // Calculate winner's reward
        // If only 1 player, winner gets 100% of pool. Otherwise, 90% (normal split)
        let total_pool = arena.total_pool;
        let winner_share_bps = if arena.player_count == 1 {
            10000 // 100% for single player arenas
        } else {
            WINNER_SHARE_BPS // 90% for multi-player arenas
        };
        let winner_reward = (total_pool * winner_share_bps) / 10000;

        // Transfer SOL from arena vault to winner
        **ctx.accounts.arena_vault.to_account_info().try_borrow_mut_lamports()? -= winner_reward;
        **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += winner_reward;

        player_entry.is_winner = true;
        player_entry.has_claimed = true;

        if arena.player_count == 1 {
            msg!("Single player winner claimed {} lamports ({} SOL) - 100% of pool", winner_reward, winner_reward as f64 / 1_000_000_000.0);
        } else {
            msg!("Winner claimed {} lamports ({} SOL) - 90% of pool", winner_reward, winner_reward as f64 / 1_000_000_000.0);
        }
        Ok(())
    }

    /// Admin claims treasury fee (10% of total pool, 0% for single-player arenas)
    pub fn claim_treasury_fee(ctx: Context<ClaimTreasuryFee>) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.global_state.admin,
            CryptarenaError::Unauthorized
        );

        let arena = &mut ctx.accounts.arena;

        require!(
            arena.status == ArenaStatus::Ended as u8,
            CryptarenaError::ArenaNotEnded
        );

        require!(
            !arena.treasury_claimed,
            CryptarenaError::TreasuryFeeAlreadyClaimed
        );

        // Calculate treasury fee
        // For single-player arenas, treasury gets 0% (winner gets 100%)
        // For multi-player arenas, treasury gets 10%
        let total_pool = arena.total_pool;
        let treasury_fee = if arena.player_count == 1 {
            0 // No treasury fee for single-player arenas
        } else {
            (total_pool * TREASURY_FEE_BPS) / 10000
        };

        // Only transfer if there's a fee to claim
        if treasury_fee > 0 {
            // Transfer SOL from arena vault to treasury
            **ctx.accounts.arena_vault.to_account_info().try_borrow_mut_lamports()? -= treasury_fee;
            **ctx.accounts.treasury_wallet.to_account_info().try_borrow_mut_lamports()? += treasury_fee;
            msg!("Treasury claimed {} lamports ({} SOL)", treasury_fee, treasury_fee as f64 / 1_000_000_000.0);
        } else {
            msg!("Treasury fee is 0 for single-player arena - nothing to claim");
        }

        arena.treasury_claimed = true;
        Ok(())
    }

    /// Claim refund for canceled arena (tie scenario)
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let arena = &ctx.accounts.arena;
        let player_entry = &mut ctx.accounts.player_entry;

        require!(
            arena.status == ArenaStatus::Canceled as u8,
            CryptarenaError::ArenaNotCanceled
        );

        require!(
            arena.is_canceled,
            CryptarenaError::ArenaNotCanceled
        );

        require!(
            !player_entry.has_claimed,
            CryptarenaError::RewardAlreadyClaimed
        );

        // Refund the entry fee
        let refund_amount = player_entry.entry_fee;

        // Transfer SOL from arena vault back to player
        **ctx.accounts.arena_vault.to_account_info().try_borrow_mut_lamports()? -= refund_amount;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += refund_amount;

        player_entry.has_claimed = true;

        msg!("Player refunded {} lamports ({} SOL)", refund_amount, refund_amount as f64 / 1_000_000_000.0);
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
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Treasury wallet to receive fees
    pub treasury_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct AddWhitelistedToken<'info> {
    #[account(seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        init,
        payer = admin,
        space = 8 + WhitelistedToken::INIT_SPACE,
        seeds = [b"whitelist_token", asset_index.to_le_bytes().as_ref()],
        bump
    )]
    pub whitelisted_token: Account<'info, WhitelistedToken>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct RemoveWhitelistedToken<'info> {
    #[account(seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"whitelist_token", asset_index.to_le_bytes().as_ref()],
        bump = whitelisted_token.bump
    )]
    pub whitelisted_token: Account<'info, WhitelistedToken>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct EnterArena<'info> {
    #[account(mut, seeds = [b"global_state"], bump = global_state.bump)]
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
        init_if_needed,
        payer = player,
        space = 8 + ArenaVault::INIT_SPACE,
        seeds = [b"arena_vault", global_state.current_arena_id.to_le_bytes().as_ref()],
        bump
    )]
    pub arena_vault: Account<'info, ArenaVault>,

    #[account(
        init,
        payer = player,
        space = 8 + PlayerEntry::INIT_SPACE,
        seeds = [b"player_entry", arena.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    /// Whitelisted token account (looked up by asset_index)
    #[account(
        seeds = [b"whitelist_token", asset_index.to_le_bytes().as_ref()],
        bump = whitelisted_token.bump
    )]
    pub whitelisted_token: Account<'info, WhitelistedToken>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartArena<'info> {
    #[account(mut, seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPlayerPrice<'info> {
    #[account(seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"player_entry", arena.key().as_ref(), player_entry.player.as_ref()],
        bump = player_entry.bump
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct EndArena<'info> {
    #[account(seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    pub admin: Signer<'info>,
    // PlayerEntry accounts passed as remaining_accounts
}

#[derive(Accounts)]
pub struct ClaimWinnerRewards<'info> {
    #[account(
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"arena_vault", arena.id.to_le_bytes().as_ref()],
        bump = arena_vault.bump
    )]
    pub arena_vault: Account<'info, ArenaVault>,

    #[account(
        mut,
        seeds = [b"player_entry", arena.key().as_ref(), winner.key().as_ref()],
        bump = player_entry.bump,
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub winner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimTreasuryFee<'info> {
    #[account(seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"arena_vault", arena.id.to_le_bytes().as_ref()],
        bump = arena_vault.bump
    )]
    pub arena_vault: Account<'info, ArenaVault>,

    /// CHECK: Treasury wallet to receive fees
    #[account(
        mut,
        constraint = treasury_wallet.key() == global_state.treasury_wallet @ CryptarenaError::InvalidTreasury
    )]
    pub treasury_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        seeds = [b"arena", arena.id.to_le_bytes().as_ref()],
        bump = arena.bump
    )]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"arena_vault", arena.id.to_le_bytes().as_ref()],
        bump = arena_vault.bump
    )]
    pub arena_vault: Account<'info, ArenaVault>,

    #[account(
        mut,
        seeds = [b"player_entry", arena.key().as_ref(), player.key().as_ref()],
        bump = player_entry.bump,
    )]
    pub player_entry: Account<'info, PlayerEntry>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub admin: Pubkey,
    pub treasury_wallet: Pubkey,
    pub arena_duration: i64,
    pub entry_fee: u64,
    pub current_arena_id: u64,
    pub is_paused: bool,
    pub bump: u8,
}

/// ArenaVault - PDA that holds SOL for an arena
#[account]
#[derive(InitSpace)]
pub struct ArenaVault {
    pub arena_id: u64,
    pub bump: u8,
}

/// Arena - Stores arena metadata and player slots
#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub id: u64,
    pub status: u8,
    pub player_count: u8,
    pub winning_asset: u8,
    pub is_canceled: bool,
    pub treasury_claimed: bool,
    pub bump: u8,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub total_pool: u64,
    // Token slots - each slot holds an asset_index (255 = empty)
    // Max 10 players, each with unique token
    #[max_len(10)]
    pub token_slots: [u8; 10],
    // Player addresses in order
    #[max_len(10)]
    pub player_addresses: [Pubkey; 10],
}

/// PlayerEntry - One per player in an arena
#[account]
#[derive(InitSpace)]
pub struct PlayerEntry {
    pub arena: Pubkey,
    pub player: Pubkey,
    pub asset_index: u8,
    pub player_index: u8,
    pub entry_fee: u64,
    pub entry_timestamp: i64,
    pub start_price: u64,
    pub end_price: u64,
    pub price_movement: i64,
    pub is_winner: bool,
    pub has_claimed: bool,
    pub bump: u8,
}

/// WhitelistedToken - Tokens allowed to be selected in arenas
/// Supports both Solana (32 bytes) and EVM (20 bytes) token addresses
#[account]
#[derive(InitSpace)]
pub struct WhitelistedToken {
    pub asset_index: u8,
    pub chain_type: u8,           // 0 = Solana, 1 = EVM (Ethereum)
    pub is_active: bool,
    pub bump: u8,
    #[max_len(32)]
    pub token_address: [u8; 32],  // Solana: full 32 bytes, EVM: first 20 bytes used
    #[max_len(10)]
    pub symbol: [u8; 10],         // Token symbol (e.g., "PYTH", "ETH")
}

// ============================================================================
// ENUMS & ERRORS
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArenaStatus {
    Uninitialized = 0,
    Waiting = 1,
    Active = 2,
    Ended = 3,
    Canceled = 4,
}

#[error_code]
pub enum CryptarenaError {
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Arena is not in waiting status")]
    ArenaNotWaiting,
    #[msg("Arena is not active")]
    ArenaNotActive,
    #[msg("Arena has not ended")]
    ArenaNotEnded,
    #[msg("Arena is not canceled")]
    ArenaNotCanceled,
    #[msg("Arena duration not complete")]
    ArenaDurationNotComplete,
    #[msg("Arena is full (max 10 players)")]
    ArenaFull,
    #[msg("Not enough players to start (minimum 1)")]
    NotEnoughPlayers,
    #[msg("Token already taken by another player")]
    TokenAlreadyTaken,
    #[msg("Not a winner")]
    NotAWinner,
    #[msg("Reward already claimed")]
    RewardAlreadyClaimed,
    #[msg("Missing price data")]
    MissingPrice,
    #[msg("Unauthorized - admin only")]
    Unauthorized,
    #[msg("Invalid duration - must be at least 3 minutes (180 seconds)")]
    InvalidDuration,
    #[msg("Invalid entry fee - must be greater than 0")]
    InvalidEntryFee,
    #[msg("Token is not whitelisted")]
    TokenNotWhitelisted,
    #[msg("Asset index does not match whitelisted token")]
    InvalidAssetIndex,
    #[msg("Treasury fee already claimed")]
    TreasuryFeeAlreadyClaimed,
    #[msg("Invalid treasury wallet")]
    InvalidTreasury,
    #[msg("Invalid chain type - must be 0 (Solana) or 1 (EVM)")]
    InvalidChainType,
}

