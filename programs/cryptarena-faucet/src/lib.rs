use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("9ZaAhicfWbLmdJUzXk2ZT1o5CTdaW6VE8mF9sju15D5E");

// ============================================================================
// CONSTANTS
// ============================================================================

pub const CLAIM_COOLDOWN: i64 = 21600; // 6 hours in seconds
pub const FAUCET_USD_VALUE: u64 = 15_000_000; // $15 with 6 decimals
pub const PYTH_PRICE_MAX_AGE: u64 = 60; // 60 seconds
pub const TOTAL_ASSETS: usize = 14;

// Asset indices (same as main program)
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

// Pyth Price Feed IDs
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
pub mod cryptarena_faucet {
    use super::*;

    /// Initialize the faucet with admin and test token mints
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let faucet_state = &mut ctx.accounts.faucet_state;
        faucet_state.admin = ctx.accounts.admin.key();
        faucet_state.is_active = true;
        faucet_state.bump = ctx.bumps.faucet_state;
        
        msg!("Faucet initialized");
        Ok(())
    }

    /// Register a test token mint for an asset
    pub fn register_token(
        ctx: Context<RegisterToken>,
        asset_index: u8,
    ) -> Result<()> {
        require!(asset_index < TOTAL_ASSETS as u8, FaucetError::InvalidAsset);

        let faucet_state = &mut ctx.accounts.faucet_state;
        faucet_state.token_mints[asset_index as usize] = ctx.accounts.token_mint.key();

        msg!("Registered token mint for asset {}", asset_index);
        Ok(())
    }

    /// Claim test tokens from the faucet
    pub fn claim(
        ctx: Context<Claim>,
        asset_index: u8,
    ) -> Result<()> {
        let faucet_state = &ctx.accounts.faucet_state;
        let user_faucet_state = &mut ctx.accounts.user_faucet_state;
        let clock = Clock::get()?;

        // Validate faucet is active
        require!(faucet_state.is_active, FaucetError::FaucetInactive);

        // Validate asset index
        require!(asset_index < TOTAL_ASSETS as u8, FaucetError::InvalidAsset);

        // Check cooldown for this specific asset
        let last_claim = user_faucet_state.last_claim_times[asset_index as usize];
        require!(
            clock.unix_timestamp >= last_claim + CLAIM_COOLDOWN,
            FaucetError::CooldownNotComplete
        );

        // Get price from Pyth oracle
        let price_update = &ctx.accounts.price_update;
        let expected_feed_id = get_pyth_feed_id(asset_index);
        let price = price_update.get_price_no_older_than(
            &clock,
            PYTH_PRICE_MAX_AGE,
            &expected_feed_id,
        )?;

        // Calculate token amount for $15 USD value
        let price_value = price.price as u64;
        let expo = price.exponent;
        let token_amount = calculate_token_amount(FAUCET_USD_VALUE, price_value, expo)?;

        // Mint tokens to user
        let seeds = &[
            b"faucet_state".as_ref(),
            &[faucet_state.bump],
        ];
        let signer = &[&seeds[..]];

        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.faucet_state.to_account_info(),
            },
            signer,
        );
        token::mint_to(mint_ctx, token_amount)?;

        // Update last claim time
        user_faucet_state.last_claim_times[asset_index as usize] = clock.unix_timestamp;
        user_faucet_state.total_claims[asset_index as usize] += 1;

        msg!(
            "User {} claimed {} tokens of asset {} (${} USD)",
            ctx.accounts.user.key(),
            token_amount,
            asset_index,
            FAUCET_USD_VALUE / 1_000_000
        );

        Ok(())
    }

    /// Initialize user faucet state
    pub fn init_user_state(ctx: Context<InitUserState>) -> Result<()> {
        let user_faucet_state = &mut ctx.accounts.user_faucet_state;
        user_faucet_state.user = ctx.accounts.user.key();
        user_faucet_state.last_claim_times = [0i64; TOTAL_ASSETS];
        user_faucet_state.total_claims = [0u64; TOTAL_ASSETS];
        user_faucet_state.bump = ctx.bumps.user_faucet_state;

        msg!("User faucet state initialized for {}", ctx.accounts.user.key());
        Ok(())
    }

    /// Admin: Pause or unpause the faucet
    pub fn set_active(ctx: Context<AdminAction>, is_active: bool) -> Result<()> {
        let faucet_state = &mut ctx.accounts.faucet_state;
        faucet_state.is_active = is_active;
        
        msg!("Faucet active status set to: {}", is_active);
        Ok(())
    }

    /// Admin: Create a new test token
    pub fn create_test_token(
        ctx: Context<CreateTestToken>,
        asset_index: u8,
        name: String,
        symbol: String,
        decimals: u8,
    ) -> Result<()> {
        require!(asset_index < TOTAL_ASSETS as u8, FaucetError::InvalidAsset);
        require!(name.len() <= 32, FaucetError::NameTooLong);
        require!(symbol.len() <= 10, FaucetError::SymbolTooLong);

        let token_metadata = &mut ctx.accounts.token_metadata;
        token_metadata.asset_index = asset_index;
        token_metadata.mint = ctx.accounts.token_mint.key();
        token_metadata.name = name.clone();
        token_metadata.symbol = symbol.clone();
        token_metadata.decimals = decimals;
        token_metadata.bump = ctx.bumps.token_metadata;

        // Register in faucet state
        let faucet_state = &mut ctx.accounts.faucet_state;
        faucet_state.token_mints[asset_index as usize] = ctx.accounts.token_mint.key();

        msg!("Created test token: {} ({}) for asset {}", name, symbol, asset_index);
        Ok(())
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn calculate_token_amount(usd_value: u64, price: u64, expo: i32) -> Result<u64> {
    // Calculate how many tokens are worth $15 at current price
    let usd_u128 = usd_value as u128;
    let price_u128 = price as u128;
    
    // Adjust for exponent
    let token_amount = if expo < 0 {
        let multiplier = 10u128.pow((-expo) as u32);
        (usd_u128 * multiplier) / price_u128
    } else {
        let divisor = 10u128.pow(expo as u32);
        usd_u128 / (price_u128 * divisor)
    };

    // Scale for token decimals (assuming 9 decimals like most SPL tokens)
    Ok((token_amount * 1_000_000_000 / 1_000_000) as u64)
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + FaucetState::INIT_SPACE,
        seeds = [b"faucet_state"],
        bump
    )]
    pub faucet_state: Account<'info, FaucetState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct RegisterToken<'info> {
    #[account(
        mut,
        seeds = [b"faucet_state"],
        bump = faucet_state.bump,
        has_one = admin
    )]
    pub faucet_state: Account<'info, FaucetState>,

    pub token_mint: Account<'info, Mint>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct Claim<'info> {
    #[account(
        seeds = [b"faucet_state"],
        bump = faucet_state.bump
    )]
    pub faucet_state: Account<'info, FaucetState>,

    #[account(
        mut,
        seeds = [b"user_faucet_state", user.key().as_ref()],
        bump = user_faucet_state.bump
    )]
    pub user_faucet_state: Account<'info, UserFaucetState>,

    #[account(
        mut,
        constraint = token_mint.key() == faucet_state.token_mints[asset_index as usize] @ FaucetError::InvalidTokenMint
    )]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_account.mint == token_mint.key() @ FaucetError::InvalidTokenAccount,
        constraint = user_token_account.owner == user.key() @ FaucetError::InvalidTokenAccount
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub price_update: Account<'info, PriceUpdateV2>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitUserState<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserFaucetState::INIT_SPACE,
        seeds = [b"user_faucet_state", user.key().as_ref()],
        bump
    )]
    pub user_faucet_state: Account<'info, UserFaucetState>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"faucet_state"],
        bump = faucet_state.bump,
        has_one = admin
    )]
    pub faucet_state: Account<'info, FaucetState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(asset_index: u8)]
pub struct CreateTestToken<'info> {
    #[account(
        mut,
        seeds = [b"faucet_state"],
        bump = faucet_state.bump,
        has_one = admin
    )]
    pub faucet_state: Account<'info, FaucetState>,

    #[account(
        init,
        payer = admin,
        space = 8 + TestTokenMetadata::INIT_SPACE,
        seeds = [b"token_metadata", asset_index.to_le_bytes().as_ref()],
        bump
    )]
    pub token_metadata: Account<'info, TestTokenMetadata>,

    /// CHECK: Token mint - should be created before this instruction
    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct FaucetState {
    pub admin: Pubkey,
    pub token_mints: [Pubkey; TOTAL_ASSETS],
    pub is_active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserFaucetState {
    pub user: Pubkey,
    pub last_claim_times: [i64; TOTAL_ASSETS],
    pub total_claims: [u64; TOTAL_ASSETS],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TestTokenMetadata {
    pub asset_index: u8,
    pub mint: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    pub decimals: u8,
    pub bump: u8,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum FaucetError {
    #[msg("Faucet is not active")]
    FaucetInactive,
    #[msg("Invalid asset index")]
    InvalidAsset,
    #[msg("Cooldown period not complete (6 hours between claims)")]
    CooldownNotComplete,
    #[msg("Invalid token mint")]
    InvalidTokenMint,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Token name too long (max 32 chars)")]
    NameTooLong,
    #[msg("Token symbol too long (max 10 chars)")]
    SymbolTooLong,
}
