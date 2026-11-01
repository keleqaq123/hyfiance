# Authorized CFI replacement — 2026-10-02

The user requested a new contract using the current project's private key after
the old immutable quote signer's key could not be recovered.

- Chain: GIWA Sepolia, 91342.
- Active CFI/vault: `0x91618694D70100edd9e6508A1d680Ea4E0797592`.
- Deployer and immutable quote signer:
  `0xee379A4fC908F03Cd886197945bf964806709D97`.
- Transaction: `0x192a3cf475abf72b24b29466839feeb365ec4454a3ab24519f8587f855420d9f`.
- Deployment block: 37573108, two confirmations verified.
- Actual deployment fee, including OP Stack L1 fee: 0.000000942801709113 ETH.
- Previous Binance vault: `0xE38214dEAC49b139d1a6376b3A58Ff72B3D0eE87`.
- Earlier Pyth vault: `0xE6ad5FE166edeA0B949180168E928Ee6AA9B7137`.

Both previous vaults had zero total principal, zero CFI supply and zero ETH
balance in the preflight. The active previous vault's principal and supply were
rechecked just before submission. No old funds were moved or contracts deleted.
Historical deployment records are retained. Contract logic remains unchanged.

The deployer file is the ignored `contracts/markets/.env`; its private key is
not printed or added to source control. The VM already holds the same wallet
as `RELAYER_PRIVATE_KEY`. In the second Compose env file, a variable reference
provides `CFI_QUOTE_SIGNER_KEY` to the API, without copying a literal key into
the tracked public configuration. This is deliberate testnet wallet reuse,
not the recommended production key separation.

Deployment can be estimated/resumed with:

```bash
cd contracts/launch-bridge
node scripts/deploy-cfi-binance.cjs ../markets/.env --redeploy --use-project-signer
```

The initial new submission also used `--send`. The saved replacement attempt
makes rerunning this command resume/verify the same transaction, not send a
duplicate. Deployment has bounded execution/L1 gas estimates and preserves
the majority of the wallet's balance for Relayer gas.

The backend staking index cursor and freshness marker are now scoped by vault
address so a replacement cannot reuse a previous vault's cursor. Existing
database history and Season achievements are preserved.

This flow uses Binance public ETHUSDT and wallet-bound EIP-712 quotes; it does
not depend on Pyth Pro entitlement. Pyth's separate live-market subscription
authorization remains unresolved. CFI is a non-transferable principal receipt,
not a pegged dollar token and not a yield promise.

Verification: unchanged contract recompiled, creation transaction bytecode and
onchain quoteSigner verified; isolated contract suite passed; backend 34 tests
passed, including the vault cursor-switch regression.

## Live VM verification

- Backend source release: `018fb8c`; frontend/Relayer were not rebuilt.
- Compose secret interpolation was checked by deriving only the public signer
  address before restart and again inside the running API. No key was logged.
- Both old principal/supply/balance and replacement runtime hash/signer were
  verified again immediately before switching.
- Public config returns the new CFI/platform address, start block and Binance
  price source. Anonymous estimates and authenticated EIP-712 quotes return 200.
- A project-wallet quote recovered the correct signer; its digest matched the
  deployed contract. `callStatic.stake` and gas estimation passed for
  0.000001 ETH, with 169734 estimated execution gas. No staking transaction
  was sent and no real principal position was created by verification.
- Real Google Chrome desktop (1440px) and mobile (390px) stake pages display
  fresh CFI estimates and the new vault link; no JavaScript/console/request
  failures were observed. Screenshots are kept under `/tmp` locally.
- API and Reality health passed. Both Relayer chains are healthy and scanning;
  two previously executed messages remain present.
- Database/runtime volumes were preserved. Backend rollback image:
  `custos-api:before-cfi-018fb8c`; previous public config and source:
  `/opt/custos/rollback-cfi-018fb8c`. VM free disk remains about 816 MB.
- The replacement's address-scoped index cursor and freshness timestamp are
  present and advancing in the live database; legacy cursors remain untouched.
