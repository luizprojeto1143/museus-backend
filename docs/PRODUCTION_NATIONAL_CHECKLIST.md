# Production National Checklist

This checklist tracks the platform work required for national rollout.

## Implemented Foundation

- Public national API under `/public/national`.
- National indicators by city, state and region.
- National ranking of cultural equipments.
- Public cultural map feed.
- Unified public search across equipments, works, events, providers and cities.
- Public digital collection feed.
- Public national services marketplace feed.
- Public national events feed.
- Shared API response helpers for success and pagination.
- Front/back contract audit script with zero unmatched frontend calls.
- Production environment validation for secrets, billing, SMTP, Redis, OpenAI and storage.
- Stripe placeholder blocked in production when billing is enabled.
- Hybrid `XP_PLUS_MONEY` marketplace purchase flow.
- Public `/nacional` frontend dashboard.
- Real-time event capacity endpoint under `/event-operations/events/:eventId/capacity`.
- Virtual queue admission endpoint under `/event-operations/events/:eventId/queue/join`.
- Generic digital ticket wallet payload under `/event-operations/registrations/:code/wallet`.
- Signed outbound webhook subscriptions under `/outbound-webhooks`.
- Outbound events emitted for `ticket.confirmed`, `ticket.checked_in` and `membership.activated`.
- Work sponsorship slots enforce either 1 exclusive sponsor or up to 10 shared sponsors per work.
- Work sponsorships activate/deactivate from Stripe subscription webhooks before logos appear publicly.
- National benefits club feed under `/memberships/benefits/national`.
- Visitor digital membership card payload under `/memberships/me/card`.

## Production Gate

Before deploying with `NODE_ENV=production`, the environment must provide:

- `APP_ENV=production` or `APP_ENV=homologation`.
- Strong `JWT_SECRET`, `REFRESH_SECRET`, `COOKIE_SECRET` and `GAME_SECRET` with 32+ characters.
- `FRONTEND_URL` with the production origin.
- `REDIS_URL`.
- `OPENAI_API_KEY`.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `MASTER_ALERT_EMAIL`.
- Stripe live keys and webhook secrets when `BILLING_MODE=live`.
- Cloud storage via complete R2 or S3 credentials.
- Database migrations applied with `prisma migrate deploy`.

## Next Functional Batches

1. Apple Wallet `.pkpass` generation with issuer certificates.
2. Google Wallet object/class issuer integration.
3. Persistent virtual queue with Redis TTL and admin controls.
4. Apple/Google Wallet activation for membership cards.
5. Project accounting and public sector export formats.
6. Teacher/school workflows expansion with scheduling reports.
7. Conservation/restoration reports with audit trail.
8. Public webhook management UI and live partner endpoint validation.
9. Push notification segmentation by tenant, city and visitor profile.
10. Shared TypeScript contracts generated from backend schemas.

## Validation Commands

```bash
npm run build
npm run audit:contracts
npm test -- --runInBand
```

Frontend:

```bash
npm run typecheck
npm run build
npm run test:run
```

## Known External Risks

- Remote Supabase pool instability can make integration tests fail with `P1001`, `P1017` or connection reset errors. Use a dedicated test database or local Postgres for reliable CI.
- FFmpeg is optional in local tests but should be installed in production workers if video compression is required.
- Payment, email, push and AI flows need live credentials and webhook verification in homologation before public launch.
- Outbound webhook consumers verify `X-Cultura-Signature` with HMAC SHA-256 over `timestamp.body` using the SHA-256 digest of the one-time `signingSecret` as the key.
