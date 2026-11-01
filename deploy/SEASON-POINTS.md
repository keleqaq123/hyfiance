# Reality task points and community feedback rewards

Deploy both `apps/api` and `apps/web` from this revision. The API creates the new
`reality_point_awards` table automatically on startup. Keep the existing database
and its backups; no reset or manual alteration of historical points is needed.

Sign in with a wallet configured in the server's `REALITY_ADMIN_WALLETS`, then open
`/#/reality/admin`. The points panel appears before contract configuration.

1. Enter the recipient's full wallet address and check their points/history.
2. For missing staking task points, enter the confirmed transaction hash and use
   **Verify & recover stake points**. The server checks GIWA chain ID, receipt,
   successful status, two confirmations, vault, sender and staking event. This is
   a read-only chain check and does not require a new stake or gas payment.
3. For a feedback reward, enter positive integer points, a reason and a unique
   feedback reference (post URL or support ticket), then award points. A retry of
   the same request cannot create another reward. An already-used reference is
   rejected. Use a distinct reference for each genuine contribution.
4. Review award history. Enter a reason to revoke an incorrect reward. The record,
   issuer and revocation audit remain in the database.

Confirmed staking earns **100 points once per wallet**, even if the wallet has not
registered its referral profile yet. Multiple deposits and transaction imports do
not earn repeated staking rewards. Feedback bonuses are added separately and are
visible in the profile total and the **Reality tasks** leaderboard; the historical
**Original Season 1** board is separate and is not modified by these rewards.

Users can also recover their own confirmed staking transactions on `/#/reality/stake`.
Network/RPC failures may delay recording; never ask the user to stake again merely
to recover points. Capture their full wallet and transaction hash to diagnose.

An upload's `Failed to fetch` means the browser did not receive a usable response;
it is not evidence of a staking failure. Check the user's Network panel and server
logs to distinguish connectivity, CORS, reverse proxy and upload errors. The client
now explains upload connectivity, expired sessions and oversized files separately.
