# Auditoria Geral do Sistema

Gerado em: 2026-07-20T18:24:33.561Z

## Resumo

- Arquivos backend analisados: 179
- Arquivos frontend analisados: 414
- Rotas backend montadas: 632
- Chamadas API no frontend: 547
- Chamadas API sem rota backend: 0
- Rotas backend sem chamada frontend direta: 253
- Telas/rotas frontend detectadas: 271
- Arquivos de tela/pagina detectados: 217
- Arquivos com formulario ou mutacao: 218
- Arquivos com marcadores pendentes: 535
- Marcadores funcionais reais: 853
- Marcadores de divida tecnica: 1581

## Modulos Com Mais Sinais de Pendencia

| Modulo | Rotas | Chamadas | Rotas front | Telas | Forms | Mutacoes | Pendencias reais | Total sinais |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| frontend:backoffice/equipment | 0 | 194 | 0 | 81 | 71 | 101 | 201 | 316 |
| frontend:visitor/pages | 0 | 123 | 0 | 56 | 32 | 33 | 119 | 237 |
| museus-frontend/src/i18n | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 102 |
| frontend:backoffice/municipal | 0 | 35 | 0 | 14 | 18 | 16 | 66 | 102 |
| frontend:master/pages | 0 | 63 | 0 | 28 | 24 | 33 | 64 | 123 |
| frontend:backoffice/producer | 0 | 43 | 0 | 1 | 11 | 15 | 44 | 59 |
| frontend:visitor/components | 0 | 10 | 0 | 0 | 14 | 7 | 28 | 40 |
| museus-frontend/src/components | 0 | 12 | 0 | 0 | 10 | 6 | 28 | 45 |
| museus-backend/src/services | 0 | 0 | 0 | 0 | 0 | 0 | 26 | 81 |
| frontend:backoffice/provider | 0 | 10 | 0 | 0 | 5 | 3 | 23 | 28 |
| museus-backend/src/tests | 0 | 0 | 0 | 0 | 0 | 0 | 22 | 30 |
| frontend:backoffice/sponsor | 0 | 4 | 0 | 9 | 4 | 2 | 16 | 17 |
| frontend:theater/pages | 0 | 0 | 0 | 7 | 5 | 0 | 14 | 22 |
| frontend:auth/RegisterProducer.tsx | 0 | 2 | 0 | 1 | 1 | 1 | 11 | 13 |
| frontend:auth/Register.tsx | 0 | 2 | 0 | 1 | 1 | 1 | 10 | 12 |
| frontend:public/ContactForm.tsx | 0 | 1 | 0 | 1 | 1 | 1 | 9 | 10 |
| frontend:totem/pages | 0 | 8 | 0 | 5 | 3 | 4 | 7 | 15 |
| frontend:auth/ResetPassword.tsx | 0 | 1 | 0 | 1 | 1 | 1 | 5 | 6 |
| frontend:auth/Login.tsx | 0 | 0 | 0 | 1 | 1 | 0 | 5 | 6 |
| frontend:auth/RegisterProvider.tsx | 0 | 1 | 0 | 1 | 1 | 1 | 4 | 5 |
| frontend:auth/ForgotPassword.tsx | 0 | 1 | 0 | 1 | 1 | 1 | 3 | 4 |
| frontend:roteiro/ProviderDetail.tsx | 0 | 2 | 0 | 0 | 1 | 1 | 3 | 6 |
| backend:routes/master | 4 | 0 | 0 | 0 | 0 | 0 | 3 | 7 |
| backend:commerce/stripe.ts | 4 | 0 | 0 | 0 | 0 | 0 | 3 | 10 |
| frontend:public/GlobalEvents.tsx | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 2 |
| frontend:totem/components | 0 | 1 | 0 | 0 | 1 | 1 | 2 | 2 |
| frontend:public/NationalCulturePage.tsx | 0 | 0 | 0 | 1 | 1 | 0 | 2 | 2 |
| frontend:public/LandingPage.tsx | 0 | 0 | 0 | 1 | 0 | 0 | 2 | 2 |
| backend:commerce/provider-dashboard.controller.ts | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 6 |
| museus-backend/create-dummy-data.ts | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| museus-frontend/src/tests | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| frontend:auth/AuthContext.tsx | 0 | 3 | 0 | 1 | 1 | 2 | 1 | 4 |
| frontend:roteiro/InteractiveMap.tsx | 0 | 1 | 0 | 0 | 1 | 1 | 1 | 5 |
| frontend:roteiro/SmartRouteGenerator.tsx | 0 | 1 | 0 | 0 | 1 | 1 | 1 | 2 |
| museus-frontend/src/utils | 0 | 1 | 0 | 0 | 1 | 1 | 1 | 13 |
| backend:cultural/curator-notes.ts | 5 | 0 | 0 | 0 | 0 | 0 | 1 | 6 |
| backend:routes/translations | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 6 |
| backend:governance/analytics.ts | 14 | 0 | 0 | 0 | 0 | 0 | 1 | 46 |
| frontend:gamification/context | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 3 |
| frontend:public/CertificateValidator.tsx | 0 | 1 | 0 | 1 | 0 | 0 | 1 | 2 |
| frontend:roteiro/CulturalPassport.tsx | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| frontend:visitor/context | 0 | 2 | 0 | 0 | 0 | 0 | 1 | 3 |
| frontend:visitor/hooks | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 4 |
| frontend:visitor/VisitorLayout.tsx | 0 | 3 | 0 | 0 | 0 | 0 | 1 | 3 |
| museus-backend/src/config | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 11 |
| museus-backend/prisma/seed.ts | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 4 |
| museus-backend/scripts/ops | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 33 |
| museus-backend/scripts/test_final.js | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 3 |
| frontend:visitor/utils | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 3 |
| museus-backend/scripts/relic_guardian.cjs | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 |
| museus-backend/docs/PRODUCTION_NATIONAL_CHECKLIST.md | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| museus-backend/src/middleware | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 7 |
| museus-frontend/README.md | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| frontend:gamification/components | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| museus-frontend/src/api | 0 | 14 | 0 | 0 | 2 | 7 | 0 | 4 |
| museus-frontend/src/hooks | 0 | 1 | 0 | 0 | 2 | 1 | 0 | 5 |
| museus-frontend/src/services | 0 | 2 | 0 | 0 | 2 | 2 | 0 | 0 |
| backend:cultural/roteiro.scoped.routes.ts | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| backend:experience/achievements.ts | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| backend:commerce/bookings.ts | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| backend:routes/categories | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| backend:trust-safety/certificate-rules.ts | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| backend:trust-safety/certificate-templates.ts | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| backend:routes/characters | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| backend:experience/clues.ts | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| backend:experience/collectibles.ts | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| backend:commerce/coupons.ts | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| backend:cultural/events.ts | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 31 |
| backend:routes/favorites | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| backend:cultural/floorPlans.ts | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| backend:routes/guestbook | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| backend:cultural/heritage.ts | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| backend:commerce/in-person-services.ts | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| backend:routes/master-fees | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| backend:routes/sponsor-portal | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| backend:routes/notices | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| backend:routes/notifications | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| backend:routes/outbound-webhooks | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| backend:governance/plans.ts | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| backend:governance/ppa.ts | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |

## Chamadas Frontend Sem Backend

- Nenhuma chamada orfa detectada pelo auditor.

## Rotas Backend Sem Chamada Frontend Direta

- DELETE /certificate-rules/:id em museus-backend/src/domains/trust-safety/certificate-rules.ts:75
- DELETE /characters/:id em museus-backend/src/routes/characters.ts:83
- DELETE /events/:id em museus-backend/src/domains/cultural/events.ts:421
- DELETE /heritage/:id em museus-backend/src/domains/cultural/heritage.ts:60
- DELETE /municipal/:id/cancel em museus-backend/src/routes/sponsor-portal.ts:427
- DELETE /notices/:id em museus-backend/src/routes/notices.ts:402
- DELETE /notifications/unregister em museus-backend/src/routes/notifications.ts:65
- DELETE /outbound-webhooks/:id em museus-backend/src/routes/outbound-webhooks.ts:138
- DELETE /projects/:id em museus-backend/src/routes/projects.ts:439
- DELETE /roteiros/:tenantSlug/providers/:id em museus-backend/src/domains/cultural/roteiro.routes.ts:19
- DELETE /seeder/bulk em museus-backend/src/routes/master/seeder.ts:112
- DELETE /stamps/:id em museus-backend/src/domains/experience/stamps.ts:91
- DELETE /tickets/:id em museus-backend/src/domains/commerce/tickets.ts:170
- DELETE /works/:id em museus-backend/src/domains/cultural/works.ts:423
- GET /:tenantSlug/master-ecosystem/reviews/pending em museus-backend/src/domains/governance/master-ecosystem.routes.ts:9
- GET /:tenantSlug/provider/products em museus-backend/src/domains/commerce/provider.routes.ts:15
- GET /:tenantSlug/roteiro/providers em museus-backend/src/domains/cultural/roteiro.scoped.routes.ts:20
- GET /:tenantSlug/roteiro/routes em museus-backend/src/domains/cultural/roteiro.scoped.routes.ts:10
- GET /accessibility-execution em museus-backend/src/routes/accessibility-execution.ts:28
- GET /accessibility/master em museus-backend/src/routes/accessibility.ts:85
- GET /achievements/:id em museus-backend/src/domains/experience/achievements.ts:26
- GET /achievements/visitor/:visitorId em museus-backend/src/domains/experience/achievements.ts:217
- GET /ai-costs/usage/:tenantId em museus-backend/src/routes/ai-costs.ts:28
- GET /analytics/popular-works/:tenantId em museus-backend/src/domains/governance/analytics.ts:194
- GET /analytics/tenant-summary/:tenantId em museus-backend/src/domains/governance/analytics.ts:151
- GET /audit-logs em museus-backend/src/domains/governance/audit.ts:53
- GET /audit-logs/entity/:entity/:id em museus-backend/src/domains/governance/audit.ts:94
- GET /audit-logs/summary em museus-backend/src/domains/governance/audit.ts:124
- GET /backup/full em museus-backend/src/routes/backup.ts:10
- GET /badges/:id/print em museus-backend/src/domains/experience/badgeRoutes.ts:162
- GET /bookings em museus-backend/src/domains/commerce/bookings.ts:12
- GET /bookings/in-person em museus-backend/src/domains/commerce/bookings.ts:84
- GET /certificates/:id/pdf em museus-backend/src/domains/trust-safety/certificates.ts:86
- GET /certificates/verify/:code em museus-backend/src/domains/trust-safety/certificates.ts:106
- GET /challenges/hunts/:id em museus-backend/src/domains/experience/challenges.ts:251
- GET /characters em museus-backend/src/routes/characters.ts:35
- GET /clues em museus-backend/src/domains/experience/clues.ts:12
- GET /coupons em museus-backend/src/domains/commerce/coupons.ts:13
- GET /curator-notes em museus-backend/src/domains/cultural/curator-notes.ts:18
- GET /curator-notes/all em museus-backend/src/domains/cultural/curator-notes.ts:46
- GET /event-operations/events/:eventId/capacity em museus-backend/src/routes/event-operations.ts:78
- GET /event-operations/registrations/:code/wallet em museus-backend/src/routes/event-operations.ts:131
- GET /events/:eventId/survey/results em museus-backend/src/routes/surveys.ts:122
- GET /events/:id/certificate/download em museus-backend/src/domains/cultural/events.ts:672
- GET /events/pos/sessions em museus-backend/src/domains/cultural/events.ts:1205
- GET /executive-reports/pdf em museus-backend/src/domains/governance/executive-reports.ts:136
- GET /financial/categories em museus-backend/src/domains/infrastructure/financial.ts:1535
- GET /financial/chargebacks em museus-backend/src/domains/infrastructure/financial.ts:1601
- GET /financial/cost-centers em museus-backend/src/domains/infrastructure/financial.ts:1476
- GET /financial/disputes em museus-backend/src/domains/infrastructure/financial.ts:1298
- GET /financial/dre em museus-backend/src/domains/infrastructure/financial.ts:891
- GET /financial/export em museus-backend/src/domains/infrastructure/financial.ts:1423
- GET /financial/payables em museus-backend/src/domains/infrastructure/financial.ts:235
- GET /financial/payouts em museus-backend/src/domains/infrastructure/financial.ts:1204
- GET /financial/receivables em museus-backend/src/domains/infrastructure/financial.ts:161
- GET /financial/reconciliation em museus-backend/src/domains/infrastructure/financial.ts:980
- GET /financial/refunds em museus-backend/src/domains/infrastructure/financial.ts:859
- GET /financial/settings/financial em museus-backend/src/domains/infrastructure/financial.ts:1707
- GET /financial/statement em museus-backend/src/domains/infrastructure/financial.ts:123
- GET /financial/stripe/dashboard-link em museus-backend/src/domains/infrastructure/financial.ts:1737
- GET /financial/stripe/status em museus-backend/src/domains/infrastructure/financial.ts:1726
- GET /financial/summary em museus-backend/src/domains/infrastructure/financial.ts:59
- GET /floor-plans em museus-backend/src/domains/cultural/floorPlans.ts:9
- GET /floor-plans/:id em museus-backend/src/domains/cultural/floorPlans.ts:30
- GET /gamification/clues em museus-backend/src/domains/experience/gamification.ts:25
- GET /gamification/leaderboard em museus-backend/src/domains/experience/gamification.ts:8
- GET /health/live em museus-backend/src/routes/health.ts:69
- GET /health/ready em museus-backend/src/routes/health.ts:71
- GET /heritage em museus-backend/src/domains/cultural/heritage.ts:9
- GET /inbox/:id em museus-backend/src/routes/inbox.ts:49
- GET /institutional-export/csv em museus-backend/src/routes/institutional-export.ts:114
- GET /institutional-export/pdf em museus-backend/src/routes/institutional-export.ts:10
- GET /leaderboard em museus-backend/src/domains/experience/leaderboard.ts:10
- GET /master/fees em museus-backend/src/routes/master-fees.ts:172
- GET /master/fees/:id/audit em museus-backend/src/routes/master-fees.ts:463
- GET /master/fees/overview em museus-backend/src/routes/master-fees.ts:55
- GET /master/fees/simulate em museus-backend/src/routes/master-fees.ts:107
- GET /master/fees/sources em museus-backend/src/routes/master-fees.ts:43
- GET /master/monitoring/api-requests em museus-backend/src/routes/master-monitoring.ts:240
- GET /memberships/benefits/national em museus-backend/src/routes/memberships.ts:45

## Telas/Paginas Mais Sensíveis

| Arquivo | APIs | Mutacoes | Forms | Inputs | Handlers | ts-nocheck | Zod |
|---|---:|---:|---:|---:|---:|---|---|
| museus-frontend/src/modules/backoffice/equipment/pages/AdminShop.tsx | 5 | 5 | 1 | 10 | 5 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminMuseumSettings.tsx | 4 | 4 | 0 | 19 | 6 | nao | sim |
| museus-frontend/src/modules/master/pages/MasterInPersonServices.tsx | 4 | 4 | 0 | 4 | 7 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminReviews.tsx | 4 | 4 | 0 | 0 | 4 | nao | sim |
| museus-frontend/src/modules/master/pages/MasterFinancialFees.tsx | 3 | 3 | 1 | 16 | 3 | nao | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalProjectForm.tsx | 3 | 3 | 1 | 14 | 7 | nao | sim |
| museus-frontend/src/modules/master/pages/MasterSkinManager.tsx | 3 | 3 | 1 | 7 | 3 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCoupons.tsx | 3 | 3 | 1 | 6 | 5 | nao | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalPPA.tsx | 3 | 3 | 0 | 5 | 0 | nao | sim |
| museus-frontend/src/modules/master/pages/MasterPlans.tsx | 3 | 3 | 1 | 5 | 3 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCalendar.tsx | 3 | 3 | 1 | 4 | 5 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCuratorNotes.tsx | 3 | 3 | 0 | 4 | 0 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTreasureHunt.tsx | 3 | 3 | 1 | 4 | 5 | nao | sim |
| museus-frontend/src/modules/visitor/pages/EventDetail.tsx | 7 | 3 | 0 | 3 | 0 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminInternalUsers.tsx | 4 | 3 | 0 | 0 | 1 | nao | nao |
| museus-frontend/src/modules/visitor/pages/VisitorWardrobe.tsx | 9 | 3 | 0 | 0 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEventForm.tsx | 2 | 2 | 0 | 29 | 2 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminWorkForm.tsx | 2 | 2 | 0 | 28 | 2 | nao | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalNoticeForm.tsx | 2 | 2 | 0 | 14 | 2 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEquipmentForm.tsx | 2 | 2 | 1 | 12 | 3 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAchievementForm.tsx | 2 | 2 | 0 | 9 | 2 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAIAssistant.tsx | 3 | 2 | 0 | 8 | 2 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminFamilyBuilder.tsx | 2 | 2 | 2 | 8 | 4 | nao | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalProviderForm.tsx | 2 | 2 | 1 | 8 | 3 | nao | sim |
| museus-frontend/src/modules/master/pages/TenantForm.tsx | 5 | 2 | 0 | 8 | 2 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTrailForm.tsx | 2 | 2 | 0 | 7 | 2 | nao | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/ServiceProviderForm.tsx | 3 | 2 | 1 | 7 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAccessibilityForm.tsx | 5 | 2 | 0 | 6 | 2 | nao | nao |
| museus-frontend/src/modules/master/pages/MasterAchievementForm.tsx | 2 | 2 | 1 | 6 | 3 | nao | sim |
| museus-frontend/src/modules/master/pages/MasterCardManager.tsx | 5 | 2 | 1 | 6 | 5 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminSpaceForm.tsx | 3 | 2 | 1 | 5 | 3 | sim | nao |
| museus-frontend/src/modules/master/pages/MasterProviders.tsx | 3 | 2 | 1 | 5 | 5 | nao | nao |
| museus-frontend/src/modules/master/pages/MasterUserForm.tsx | 4 | 2 | 1 | 5 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminBoxOffice.tsx | 2 | 2 | 0 | 4 | 0 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCollaboratorForm.tsx | 3 | 2 | 1 | 4 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTranslations.tsx | 4 | 2 | 0 | 4 | 0 | sim | nao |
| museus-frontend/src/modules/master/pages/MasterDashboard.tsx | 4 | 2 | 0 | 4 | 2 | nao | nao |
| museus-frontend/src/modules/visitor/pages/SchedulingPage.tsx | 4 | 2 | 1 | 4 | 1 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCategoryForm.tsx | 3 | 2 | 1 | 3 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminNotifications.tsx | 2 | 2 | 1 | 3 | 1 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAIDescriptions.tsx | 3 | 2 | 0 | 1 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminSponsorships.tsx | 3 | 2 | 0 | 1 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminUploads.tsx | 2 | 2 | 0 | 1 | 2 | nao | sim |
| museus-frontend/src/modules/master/pages/TenantsList.tsx | 3 | 2 | 0 | 1 | 2 | nao | nao |
| museus-frontend/src/modules/visitor/pages/VisitorRPG.tsx | 4 | 2 | 0 | 1 | 0 | sim | nao |
| museus-frontend/src/modules/auth/AuthContext.tsx | 3 | 2 | 0 | 0 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAchievements.tsx | 3 | 2 | 0 | 0 | 2 | nao | nao |
| museus-frontend/src/modules/totem/pages/TotemValidator.tsx | 2 | 2 | 0 | 0 | 0 | sim | nao |
| museus-frontend/src/modules/visitor/pages/TrailDetail.tsx | 4 | 2 | 0 | 0 | 0 | sim | nao |
| museus-frontend/src/modules/visitor/pages/WorkDetail.tsx | 7 | 2 | 0 | 0 | 0 | sim | nao |
| museus-frontend/src/modules/auth/RegisterProducer.tsx | 2 | 1 | 1 | 9 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminBookingForm.tsx | 4 | 1 | 0 | 8 | 2 | sim | nao |
| museus-frontend/src/modules/auth/Register.tsx | 2 | 1 | 1 | 7 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCollectibles.tsx | 4 | 1 | 0 | 6 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminQuizBuilder.tsx | 3 | 1 | 0 | 6 | 3 | sim | nao |
| museus-frontend/src/modules/auth/RegisterProvider.tsx | 1 | 1 | 1 | 5 | 1 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminConservation.tsx | 4 | 1 | 0 | 5 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminMemberships.tsx | 3 | 1 | 0 | 5 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTimelineBuilder.tsx | 3 | 1 | 1 | 5 | 1 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminVolunteers.tsx | 2 | 1 | 0 | 5 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalSponsorships.tsx | 2 | 1 | 1 | 5 | 3 | nao | nao |
| museus-frontend/src/modules/visitor/pages/BadgeRequestPage.tsx | 3 | 1 | 1 | 5 | 3 | sim | nao |
| museus-frontend/src/modules/visitor/pages/GroupCheckout.tsx | 1 | 1 | 0 | 5 | 1 | nao | nao |
| museus-frontend/src/modules/visitor/pages/TeacherPortal.tsx | 2 | 1 | 0 | 5 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEventSurvey.tsx | 3 | 1 | 0 | 4 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminKidsMode.tsx | 1 | 1 | 0 | 4 | 0 | sim | nao |
| museus-frontend/src/modules/public/ContactForm.tsx | 1 | 1 | 1 | 4 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminQRCodes.tsx | 1 | 1 | 0 | 3 | 2 | nao | nao |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalNoticeProjects.tsx | 3 | 1 | 0 | 3 | 0 | sim | nao |
| museus-frontend/src/modules/master/pages/MasterAccessibilityRequests.tsx | 1 | 1 | 0 | 3 | 0 | nao | sim |
| museus-frontend/src/modules/visitor/pages/TicketTransfer.tsx | 1 | 1 | 0 | 3 | 0 | sim | nao |
| museus-frontend/src/modules/auth/ResetPassword.tsx | 1 | 1 | 1 | 2 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminScanner.tsx | 1 | 1 | 0 | 2 | 0 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminSponsorshipSettings.tsx | 2 | 1 | 0 | 2 | 2 | sim | nao |
| museus-frontend/src/modules/backoffice/sponsor/pages/SponsorAssets.tsx | 1 | 1 | 1 | 2 | 1 | nao | nao |
| museus-frontend/src/modules/visitor/pages/EventSurveyPage.tsx | 4 | 1 | 1 | 2 | 3 | sim | nao |
| museus-frontend/src/modules/auth/ForgotPassword.tsx | 1 | 1 | 1 | 1 | 3 | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEventCheckIn.tsx | 1 | 1 | 0 | 1 | 0 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminInPersonServices.tsx | 2 | 1 | 0 | 1 | 0 | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminMapEditor.tsx | 3 | 1 | 0 | 1 | 2 | sim | nao |

## Telas Sem Chamada API Direta no Proprio Arquivo

- museus-frontend/src/modules/backoffice/sponsor/pages/SponsorCheckout.tsx
- museus-frontend/src/modules/master/pages/MasterSeeder.tsx
- museus-frontend/src/modules/theater/pages/TheaterPlaybill.tsx
- museus-frontend/src/modules/backoffice/sponsor/pages/SponsorOpportunities.tsx
- museus-frontend/src/modules/auth/Login.tsx
- museus-frontend/src/modules/public/NationalCulturePage.tsx
- museus-frontend/src/modules/visitor/pages/SmartItineraryWizard.tsx
- museus-frontend/src/modules/backoffice/municipal/pages/MunicipalCulturalGaps.tsx
- museus-frontend/src/modules/backoffice/municipal/pages/MunicipalHeritage.tsx
- museus-frontend/src/modules/theater/pages/TheaterCast.tsx
- museus-frontend/src/modules/theater/pages/TheaterMobileBoxOffice.tsx
- museus-frontend/src/modules/theater/pages/TheaterSeatEditor.tsx
- museus-frontend/src/modules/theater/pages/TheaterSubscriptions.tsx
- museus-frontend/src/modules/auth/RegisterWrapper.tsx
- museus-frontend/src/modules/backoffice/equipment/pages/ConditionalAdminDashboard.tsx
- museus-frontend/src/modules/backoffice/sponsor/pages/SponsorBrowseWorks.tsx
- museus-frontend/src/modules/backoffice/sponsor/pages/SponsorLanding.tsx
- museus-frontend/src/modules/backoffice/sponsor/pages/SponsorSuccess.tsx
- museus-frontend/src/modules/public/AccessDeniedPage.tsx
- museus-frontend/src/modules/public/LandingPage.tsx
- museus-frontend/src/modules/public/NotFound.tsx
- museus-frontend/src/modules/theater/pages/TheaterCueMaster.tsx
- museus-frontend/src/modules/theater/pages/TheaterDashboard.tsx
- museus-frontend/src/modules/totem/pages/TotemDashboard.tsx
- museus-frontend/src/modules/visitor/pages/Achievements.tsx
- museus-frontend/src/modules/visitor/pages/ScannerHub.tsx
- museus-frontend/src/modules/visitor/pages/ShopPage.tsx
- museus-frontend/src/modules/visitor/pages/Welcome.tsx
- museus-frontend/src/modules/visitor/pages/WorksList.tsx

## Formularios e Mutacoes Para Revisao

| Arquivo | Forms | Inputs | Handlers | Mutacoes | Loading | Erro | Toast | Zod |
|---|---:|---:|---:|---:|---|---|---|---|
| museus-frontend/src/modules/backoffice/producer/ProducerProjectForm.tsx | 0 | 10 | 10 | 6 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminShop.tsx | 1 | 10 | 5 | 5 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminMuseumSettings.tsx | 0 | 19 | 6 | 4 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/MasterInPersonServices.tsx | 0 | 4 | 7 | 4 | sim | sim | sim | sim |
| museus-frontend/src/api/theater.ts | 0 | 0 | 0 | 4 | nao | nao | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminReviews.tsx | 0 | 0 | 4 | 4 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/MasterFinancialFees.tsx | 1 | 16 | 3 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalProjectForm.tsx | 1 | 14 | 7 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/MasterSkinManager.tsx | 1 | 7 | 3 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCoupons.tsx | 1 | 6 | 5 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalPPA.tsx | 0 | 5 | 0 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/MasterPlans.tsx | 1 | 5 | 3 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCalendar.tsx | 1 | 4 | 5 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCuratorNotes.tsx | 0 | 4 | 0 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTreasureHunt.tsx | 1 | 4 | 5 | 3 | sim | sim | sim | sim |
| museus-frontend/src/modules/visitor/pages/EventDetail.tsx | 0 | 3 | 0 | 3 | sim | sim | sim | nao |
| museus-frontend/src/api/spaces.ts | 0 | 0 | 0 | 3 | nao | nao | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminInternalUsers.tsx | 0 | 0 | 1 | 3 | sim | sim | sim | nao |
| museus-frontend/src/modules/visitor/pages/VisitorWardrobe.tsx | 0 | 0 | 0 | 3 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEventForm.tsx | 0 | 29 | 2 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminWorkForm.tsx | 0 | 28 | 2 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalNoticeForm.tsx | 0 | 14 | 2 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEquipmentForm.tsx | 1 | 12 | 3 | 2 | sim | sim | sim | sim |
| museus-frontend/src/components/shop/ShopComponents.tsx | 0 | 11 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAchievementForm.tsx | 0 | 9 | 2 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/producer/ProducerEventForm.tsx | 1 | 9 | 3 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAIAssistant.tsx | 0 | 8 | 2 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminFamilyBuilder.tsx | 2 | 8 | 4 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalProviderForm.tsx | 1 | 8 | 3 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/TenantForm.tsx | 0 | 8 | 2 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTrailForm.tsx | 0 | 7 | 2 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/backoffice/equipment/pages/ServiceProviderForm.tsx | 1 | 7 | 3 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAccessibilityForm.tsx | 0 | 6 | 2 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/master/pages/MasterAchievementForm.tsx | 1 | 6 | 3 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/MasterCardManager.tsx | 1 | 6 | 5 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminSpaceForm.tsx | 1 | 5 | 3 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/master/pages/MasterProviders.tsx | 1 | 5 | 5 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/master/pages/MasterUserForm.tsx | 1 | 5 | 3 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminBoxOffice.tsx | 0 | 4 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCollaboratorForm.tsx | 1 | 4 | 3 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminTranslations.tsx | 0 | 4 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/master/pages/MasterDashboard.tsx | 0 | 4 | 2 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/visitor/pages/SchedulingPage.tsx | 1 | 4 | 1 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminCategoryForm.tsx | 1 | 3 | 3 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminNotifications.tsx | 1 | 3 | 1 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/producer/ProducerDocuments.tsx | 0 | 2 | 2 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/certificates/CertificateEditor.tsx | 0 | 1 | 2 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAIDescriptions.tsx | 0 | 1 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminSponsorships.tsx | 0 | 1 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminUploads.tsx | 0 | 1 | 2 | 2 | sim | sim | sim | sim |
| museus-frontend/src/modules/master/pages/TenantsList.tsx | 0 | 1 | 2 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/visitor/pages/VisitorRPG.tsx | 0 | 1 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/components/ui/FavoriteButton.tsx | 0 | 0 | 0 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/auth/AuthContext.tsx | 0 | 0 | 0 | 2 | nao | sim | nao | nao |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAchievements.tsx | 0 | 0 | 2 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/totem/pages/TotemValidator.tsx | 0 | 0 | 0 | 2 | sim | sim | sim | nao |
| museus-frontend/src/modules/visitor/pages/TrailDetail.tsx | 0 | 0 | 0 | 2 | nao | sim | nao | nao |
| museus-frontend/src/modules/visitor/pages/WorkDetail.tsx | 0 | 0 | 0 | 2 | sim | sim | nao | nao |
| museus-frontend/src/modules/backoffice/municipal/MunicipalSettings.tsx | 0 | 11 | 2 | 1 | sim | sim | sim | nao |
| museus-frontend/src/modules/auth/RegisterProducer.tsx | 1 | 9 | 3 | 1 | sim | sim | nao | nao |

## Marcadores Pendentes/Mocagem/Placeholder

| Arquivo | Real | Tecnico | Total | TODO | Mock | Placeholder | ts-nocheck | alert/confirm | any/unknown |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| museus-frontend/src/i18n/locales/pt-br.json | 36 | 0 | 36 | 3 | 0 | 33 | 0 | 0 | 0 |
| museus-frontend/src/i18n/locales/es.json | 34 | 0 | 34 | 6 | 0 | 28 | 0 | 0 | 0 |
| museus-frontend/src/i18n/locales/en.json | 32 | 0 | 32 | 0 | 0 | 32 | 0 | 0 | 0 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminWorkForm.tsx | 18 | 8 | 26 | 0 | 0 | 18 | 0 | 0 | 6 |
| museus-backend/src/services/stripeService.ts | 15 | 12 | 27 | 0 | 3 | 12 | 0 | 0 | 6 |
| museus-frontend/src/components/shop/ShopComponents.tsx | 11 | 7 | 18 | 1 | 0 | 9 | 1 | 0 | 6 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEventForm.tsx | 11 | 6 | 17 | 0 | 0 | 11 | 0 | 0 | 3 |
| museus-frontend/src/modules/auth/RegisterProducer.tsx | 11 | 2 | 13 | 0 | 0 | 10 | 1 | 0 | 1 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminEquipmentForm.tsx | 11 | 1 | 12 | 0 | 0 | 11 | 0 | 0 | 1 |
| museus-frontend/src/modules/auth/Register.tsx | 10 | 2 | 12 | 0 | 0 | 9 | 1 | 0 | 1 |
| museus-frontend/src/modules/backoffice/sponsor/pages/SponsorCheckout.tsx | 10 | 1 | 11 | 0 | 0 | 10 | 0 | 0 | 0 |
| museus-frontend/src/modules/visitor/pages/CityDashboard.tsx | 10 | 1 | 11 | 0 | 1 | 8 | 1 | 0 | 1 |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalProjectForm.tsx | 9 | 8 | 17 | 0 | 0 | 9 | 0 | 0 | 5 |
| museus-frontend/src/modules/backoffice/municipal/MunicipalSettings.tsx | 9 | 3 | 12 | 1 | 0 | 7 | 1 | 0 | 3 |
| museus-frontend/src/modules/public/ContactForm.tsx | 9 | 1 | 10 | 0 | 0 | 8 | 1 | 0 | 1 |
| museus-frontend/src/modules/backoffice/producer/ProducerProjectForm.tsx | 8 | 7 | 15 | 0 | 1 | 4 | 1 | 2 | 5 |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalNoticeForm.tsx | 8 | 4 | 12 | 0 | 0 | 8 | 0 | 0 | 3 |
| museus-frontend/src/modules/master/pages/MasterAchievementForm.tsx | 8 | 1 | 9 | 0 | 0 | 8 | 0 | 0 | 1 |
| museus-frontend/src/modules/visitor/pages/CityHub.tsx | 8 | 1 | 9 | 0 | 0 | 7 | 1 | 0 | 1 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminAIAssistant.tsx | 8 | 0 | 8 | 0 | 0 | 8 | 0 | 0 | 0 |
| museus-frontend/src/modules/backoffice/provider/ProviderProfile.tsx | 7 | 2 | 9 | 0 | 0 | 6 | 1 | 0 | 2 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminMuseumSettings.tsx | 7 | 1 | 8 | 0 | 0 | 7 | 0 | 0 | 1 |
| museus-frontend/src/modules/backoffice/provider/ProviderInbox.tsx | 7 | 0 | 7 | 0 | 0 | 7 | 0 | 0 | 0 |
| museus-frontend/src/modules/master/pages/TenantForm.tsx | 6 | 4 | 10 | 0 | 0 | 5 | 1 | 0 | 2 |
| museus-frontend/src/modules/visitor/pages/LeaderboardPage.tsx | 6 | 1 | 7 | 0 | 0 | 6 | 0 | 0 | 1 |
| museus-backend/src/tests/integration/finance_flows.test.ts | 6 | 0 | 6 | 0 | 2 | 3 | 1 | 0 | 0 |
| museus-frontend/src/modules/backoffice/producer/ProducerEventForm.tsx | 6 | 0 | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| museus-frontend/src/modules/backoffice/producer/ProducerInbox.tsx | 6 | 0 | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| museus-frontend/src/modules/theater/pages/TheaterPlaybill.tsx | 6 | 0 | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| museus-frontend/src/modules/master/pages/MasterFinancialFees.tsx | 5 | 9 | 14 | 0 | 0 | 5 | 0 | 0 | 5 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminBoxOffice.tsx | 5 | 7 | 12 | 1 | 0 | 4 | 0 | 0 | 6 |
| museus-frontend/src/modules/visitor/pages/SelectMuseum.tsx | 5 | 4 | 9 | 0 | 0 | 5 | 0 | 0 | 4 |
| museus-frontend/src/modules/master/pages/MasterProviders.tsx | 5 | 3 | 8 | 0 | 0 | 4 | 0 | 1 | 3 |
| museus-frontend/src/modules/master/pages/TenantsList.tsx | 5 | 3 | 8 | 0 | 0 | 3 | 0 | 2 | 3 |
| museus-frontend/src/modules/visitor/pages/TeacherPortal.tsx | 5 | 3 | 8 | 0 | 0 | 4 | 1 | 0 | 3 |
| museus-frontend/src/modules/auth/Login.tsx | 5 | 1 | 6 | 0 | 0 | 5 | 0 | 0 | 1 |
| museus-frontend/src/modules/auth/ResetPassword.tsx | 5 | 1 | 6 | 0 | 0 | 4 | 1 | 0 | 1 |
| museus-frontend/src/modules/backoffice/equipment/pages/AdminShop.tsx | 5 | 1 | 6 | 0 | 0 | 5 | 0 | 0 | 1 |
| museus-frontend/src/modules/backoffice/municipal/pages/MunicipalProviderForm.tsx | 5 | 1 | 6 | 0 | 0 | 5 | 0 | 0 | 1 |
| museus-frontend/src/modules/backoffice/producer/ProducerProfile.tsx | 5 | 1 | 6 | 0 | 0 | 4 | 1 | 0 | 1 |
