# GIWA Reality Launchpad deployment

Network: GIWA Sepolia, chain ID 91342, native currency ETH.

Contract: `0x61Ce8427cFC9947dAe0eBc84E367d6e666f90285`

Deployment transaction: `0x37e0a99bb00cb0dcf5e11ac8e896daf936a22150e53b9508f47e0de7ac36285b`

Block: 37434614. Runtime bytecode verified against the tracked compiled artifact.

The local preview's persistent Reality database is configured with this address.
For a future server installation, set:

```env
REALITY_LAUNCHPAD_ADDRESS=0x61Ce8427cFC9947dAe0eBc84E367d6e666f90285
```

Users save an original image and project information, then sign their own
`createLaunch` transaction. Free issuance has no certification requirement.
The token appears in the RWA exchange after successful chain attachment.
ETH purchases and approved token sales use the launch's curve directly;
this flow does not need a Uniswap router or an initial external LP deposit.
Actual ETH reserves come from purchases and back sales. A curve token does
not automatically confer ownership or legal rights to the uploaded object.

The old oracle markets use tUSDC and are not native-ETH pools.
External/platform tokens still require separately configured compatible pools;
this deployment does not automatically give arbitrary tokens liquidity.

## Deployment script

From this directory, after installing the pinned dependencies:

```powershell
node scripts/deploy-reality.cjs 'PATH-TO-LOCAL-DEPLOYMENT.env'
node scripts/deploy-reality.cjs 'PATH-TO-LOCAL-DEPLOYMENT.env' --send
```

The first invocation estimates execution gas without sending. The second sends
only on chain 91342, subject to a fee cap and balance check. A pending transaction
is recorded immediately in `deployments/giwa-reality.json`; subsequent calls
resume verification rather than deploy twice. Keep that record. Credentials are
read locally and never written into the deployment record or website.

Validation: contract tests and isolated-chain client tests cover native buys,
approved token sales, slippage, expiry and token/config identity checks.
No demonstration asset was issued on the public testnet by the deployment tool.
