## CFI staking and account center (October 1, 2026)

The Reality UI is English. Account pages provide display-name editing, native ETH/CFI/principal balances, project holdings and wallet-scoped transaction history.

Active GIWA Sepolia (91342) vault and account-bound CFI receipt: `0x91618694D70100edd9e6508A1d680Ea4E0797592`.
Deployment transaction: `0x192a3cf475abf72b24b29466839feeb365ec4454a3ab24519f8587f855420d9f`, block 37573108 (October 2 replacement).
Immutable quote signer: project wallet `0xee379A4fC908F03Cd886197945bf964806709D97`.
Previous Binance vault `0xE38214dEAC49b139d1a6376b3A58Ff72B3D0eE87` had zero principal/supply/balance before replacement. Its missing immutable signing key prevented new signed deposits; no funds were migrated.

- ETH stays in the immutable contract. There is no administrator withdrawal.
- Minting uses the Binance public ETHUSDT ticker: https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT . No Binance API key or Pyth subscription is required for this staking flow.
- CFI minted = deposited ETH multiplied by its current ETH/USDT price. A 1 ETH deposit at 2,000 USDT mints 2,000 CFI; at 2,222 USDT it mints 2,222 CFI. USDT is the quote currency, not a guaranteed USD price.
- Binance does not sign the onchain quote. The contract trusts the configured backend operator signer. EIP-712 quotes bind the wallet, amount, price, nonce, chain and vault, expire within 60 seconds and cannot be replayed. Quotes refresh every 15 seconds in the visible UI; a new signed quote is fetched before each deposit.
- CFI has 18 decimals and is account-bound. Burning the entire balance returns the original ETH principal; partial burns return proportional principal. Multiple deposits aggregate. CFI is a receipt with no dollar peg or promised yield.
- A price/API failure blocks new deposits but does not block withdrawals. Unstaking requires no oracle or backend price quote.
- The first confirmed stake earns 100 Season 1 points once per wallet. GIWA transaction receipts are verified automatically.
- The previous Pyth vault `0xE6ad5FE166edeA0B949180168E928Ee6AA9B7137` had zero principal before switching. Its source and deployment record remain historical; no user deposits were migrated.

### Backend configuration

```env
REALITY_CFI_STAKING=0x91618694D70100edd9e6508A1d680Ea4E0797592
REALITY_CFI_START_BLOCK=37573108
REALITY_CFI_PRICE_SOURCE=binance
CFI_QUOTE_SIGNER_KEY=
```

The replacement explicitly uses the existing project wallet. On the VM, Compose resolves `CFI_QUOTE_SIGNER_KEY` from the secret `RELAYER_PRIVATE_KEY`; tracked configuration contains only a variable reference. Do not generate a different key for this immutable signer or put a key in a VITE_ variable. Production should separate signer and Relayer wallets. Pyth settings remain independent of CFI staking.

Contract commands in `contracts/launch-bridge`: `node scripts/compile-cfi-binance.cjs`, `node scripts/test-cfi-binance.cjs`. The deployment script estimates by default and sends only with `--send`; an existing verified record is reused.

Validation: production frontend build and 22 backend tests passed. Contract tests cover price conversion, tampering, signer/chain/vault binding, quote expiry, nonce replay, slippage, custody and partial/full redemption. A live Binance signed quote was recovered to the configured signer and its digest matched the deployed GIWA contract. No user staking transaction was submitted during verification.
