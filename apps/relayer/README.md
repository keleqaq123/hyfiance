# Custos Bridge Relayer

This service is the off-chain worker between the two `CustosBridge` contracts.
It polls both source chains for finalized `MessageSent` events, persists the
message payload, and calls `executeMessage` on the configured destination chain.

The bridge contracts remain responsible for trusted remote validation and replay
protection. The relayer is responsible for transport, retries, and destination
transaction submission.

## Run locally

```bash
cd apps/relayer
npm install
cp .env.example .env
RELAYER_PRIVATE_KEY="<authorized-relayer-private-key>" npm start
```

The wallet must be configured as `relayer` (or `admin`) on both bridge
contracts and must have native gas on both chains. The current public testnet
deployment still has the deployer wallet configured as the relayer; production
should use a dedicated wallet and call `setRelayer` on both bridges first.

Health and message endpoints:

```text
GET http://127.0.0.1:8090/health
GET http://127.0.0.1:8090/messages
GET http://127.0.0.1:8090/messages/<message-id>
```

On first start, `latest` start blocks intentionally avoid replaying old public
messages. Set `RELAYER_CHAIN_A_START_BLOCK` and
`RELAYER_CHAIN_B_START_BLOCK` to explicit deployment blocks when backfilling is
required. State is written atomically to `RELAYER_STATE_FILE`, so a restart
resumes block cursors and pending executions.

## Local two-chain smoke

Use the deterministic Anvil key only with local Anvil chains. Set both start
blocks to `0`, point the deployment record at the local pair, start the service,
then call `bridgeOut` on either chain. The relayer will execute the destination
mint automatically. The HTTP status endpoint exposes the source and destination
transaction hashes.
