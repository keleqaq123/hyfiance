# Hyfiance hosting preparation

Status: deployment configuration prepared; no cloud deployment or public URL has been created yet.

Use the independent public repository https://github.com/keleqaq123/hyfiance.
`render.yaml` declares one **free** Docker web service. The multi-stage
`deploy/hyfiance.Dockerfile` builds the SDK and frontend, then runs Python
`hosted:app`. Frontend and `/api` share one HTTPS origin. Local `.env`, wallets,
databases, uploads and Git metadata are excluded from the image build context.

## Required before deployment

- Connect the owner's Render account and select this independent repository.
- Provision an external persistent PostgreSQL database. Set `REALITY_DATABASE_URL` privately.
- Provision a GCS bucket with restricted service account access. Set `REALITY_GCS_BUCKET`
  and add the service account JSON as Render secret file `gcs.json`.
  Never commit the credential file or a database URL.
- Set the existing Elysium quote signer key as server-only `CFI_QUOTE_SIGNER_KEY`.
  The deployer wallet key is **not** needed on the hosting service.
- Set the authorized moderation wallet(s) in `REALITY_ADMIN_WALLETS`.
- Configure the actual HTTPS URL in `REALITY_PUBLIC_ORIGIN` after Render assigns it.

No paid database/disk is declared by the blueprint. Storage still needs separate
provisioning and verification of its provider's free allowances. Render free web
services sleep after 15 minutes idle and do not preserve local file changes.
The hosted entrypoint rejects missing external database/bucket configuration.
See https://render.com/docs/free.

## Release checks

Build the container and check `/`, a referenced JS asset, `/api/health`,
`/api/reality/config` and `/api/reality/assets`. Verify chain 99801 and the
deployed addresses. Points and synthetic routes must return JSON 404. Confirm
wallet login, uploads, project display and quote signing on the final HTTPS URL.
Migrate existing test project records/files with a separate private backup;
they are intentionally not part of the public image. Update NFT metadata URLs
only after the final hostname is assigned. Do not modify original Custos hosting.
