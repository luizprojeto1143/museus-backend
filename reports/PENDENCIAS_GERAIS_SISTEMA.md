# Pendencias Gerais do Sistema

Gerado em: 2026-07-20.

## Resumo executivo

O sistema esta bem conectado no contrato front/back: a auditoria encontrou 638 chamadas de API no frontend e 0 chamadas sem rota correspondente no backend. Isso e um ponto forte.

Mesmo assim, o sistema ainda nao pode ser considerado "perfeito" ou totalmente pronto para expansao nacional sem uma rodada de correcoes e homologacao. As pendencias principais estao em quatro grupos: rotas/fluxos duplicados ou sem tela clara, formularios criticos sem validacao forte, muitas telas importantes com `@ts-nocheck`, e endpoints robustos no backend que ainda parecem nao ter experiencia completa no frontend.

Relatorios brutos gerados:

- `reports/system-inventory-audit.json`
- `reports/SYSTEM_INVENTORY_AUDIT.md`

## Numeros da auditoria

- Backend: 178 arquivos de codigo analisados.
- Frontend: 414 arquivos de codigo analisados.
- Rotas backend montadas: 630.
- Chamadas API no frontend: 638.
- Chamadas frontend sem backend: 0.
- Rotas backend sem chamada direta detectada no frontend: 217.
- Rotas/telas declaradas no frontend: 271.
- Arquivos reais de pagina/tela: 217.
- Arquivos com formulario ou mutacao: 218.
- Sinais funcionais para revisar: 894.
- Sinais de divida tecnica: 1603.

Observacao: nem todo "sinal" e bug. `placeholder` pode ser apenas atributo normal de input, e rotas sem chamada direta podem ser webhooks, downloads, healthchecks, rotas externas ou chamadas dinamicas. Os itens abaixo sao os que realmente merecem decisao/correcao.

## Bloqueadores ou alto risco

### Resolvidos nesta rodada

1. Duplicidade operacional de `roteiro`.
   As rotas foram separadas em dois roteadores: um para `/roteiro/:tenantSlug/...` e `/roteiros/:tenantSlug/...`, outro para `/:tenantSlug/roteiro/...`. O caminho duplicado `/:tenantSlug/roteiro/:tenantSlug/...` deixou de existir no contrato auditado.

2. Duplicidade funcional de `GET /sponsor-portal/my-sponsorships`.
   O portal agora tem endpoints claros: `/my-work-sponsorships` para patrocinios diretos de obra, `/my-contracts` para contratos/oportunidades/assets e `/my-sponsorships` apenas como alias legado do dashboard direto.

3. Logos/assets de patrocinio conectados a exibicao publica.
   A rota publica de patrocinadores da obra agora retorna tanto `WorkSponsorship` ativo quanto assets `LOGO` aprovados de contratos ativos vinculados a oportunidade do tipo `WORK`.

4. Typecheck religado nas paginas do sponsor.
   As paginas de sponsor deixaram de usar `@ts-nocheck` e os fluxos de checkout/oportunidade passaram a ter validacao Zod no frontend.

### Ainda pendentes

1. Resolver telas criticas com `@ts-nocheck`.
   Foram encontrados 186 arquivos com `@ts-nocheck`, incluindo telas de cadastro, pagamento, obra, evento, projetos, ingressos, visitante, sponsor e master. Para producao nacional, isso e risco real porque o typecheck nao protege esses fluxos.

2. Validar formularios criticos com schema.
   Muitos formularios com mutacao nao usam Zod/react-hook-form/schema local. Prioridade: obra, evento, equipamento, loja, financeiro master, projeto municipal, edital municipal, patrocinio checkout, cadastro de produtor/prestador e configuracoes do museu.

3. Revisar endpoints backend robustos sem tela clara.
   A auditoria encontrou 217 rotas sem chamada direta no frontend. As mais sensiveis sao financeiro completo, audit logs, backup, outbound webhooks, membership card, wallet de ingresso, event operations, monitoramento e parte de patrocinios municipais.

## Modulos prioritarios

### Backoffice equipamento/admin

Maior area do sistema: 81 telas, 243 chamadas API, 71 arquivos com formulario/mutacao e 116 mutacoes.

Pendencias:

- Remover `@ts-nocheck` das telas principais.
- Colocar validacao forte em `AdminWorkForm`, `AdminEventForm`, `AdminEquipmentForm`, `AdminTrailForm`, `AdminMuseumSettings`, `AdminShop`, `AdminBoxOffice`, `AdminCalendar`, `AdminUploads`, `AdminQRCodes`.
- Trocar `confirm/alert` nativo por modal consistente em exclusoes e acoes destrutivas.
- Revisar placeholders/textos quebrados/encoding em telas administrativas.
- Homologar uploads, exclusoes, criacao/edicao e rollback de erro.

### Visitante/publico

Area com 56 telas e 123 chamadas API.

Pendencias:

- Remover `@ts-nocheck` de telas centrais: `WorkDetail`, `WorksList`, `EventsList`, `CityHub`, `CityDashboard`, `VisitorProfile`, `VisitorMembership`, `ScannerPage`, `TicketTransfer`, `PublicPassportPage`, `VisitorRPG`, `VisitorWardrobe`.
- Validar fluxo completo de compra/ingresso/grupo/transferencia/check-in/passaporte.
- Revisar telas sem chamada API direta para confirmar se sao estaticas por escolha ou incompletas: `SmartItineraryWizard`, `Achievements`, `ShopPage`, `WorksList`, `Welcome`.
- Corrigir textos com encoding quebrado em paginas publicas.

### Master

Area com 28 telas, 87 chamadas API e 41 mutacoes.

Pendencias:

- Validar especialmente `MasterFinancialFees`, `MasterPlans`, `MasterSeeder`, `MasterSkinManager`, `MasterInPersonServices`, `MasterUserForm`, `TenantForm`.
- Reconciliar telas master de monitoramento com rotas `/monitoring/*`, `/master/monitoring/*`, `/audit-logs/*`.
- Confirmar que logs, auditoria, integracoes, jobs, seguranca e tenants tem filtros, paginacao e permissao corretos.

### Municipal

Area com projetos, editais, PPA, patrimonio, lacunas culturais e patrocinio municipal.

Pendencias:

- Validar `MunicipalProjectForm`, `MunicipalNoticeForm`, `MunicipalPPA`, `MunicipalProviderForm`, `MunicipalSponsorships`.
- Garantir regras de aprovacao/reprovacao/publicacao com trilha de auditoria.
- Confirmar se endpoints de patrocinios municipais estao realmente consumidos no painel correto.
- Revisar exportacoes/TCE e relatorios de prestacao de contas.

### Patrocinios

Estado atual:

- Logo de patrocinador embaixo da obra esta ligada ao retorno de patrocinadores da obra no frontend.
- Regra de limite compartilhado foi implementada para 10 cotas compartilhadas por obra.
- Exclusivo bloqueia compartilhado e compartilhado bloqueia exclusivo quando ha patrocinios reservados/ativos.

Pendencias:

- Corrigir rota duplicada `GET /my-sponsorships`.
- Separar ou unificar modelos: patrocinio direto de obra versus oportunidade/contrato/asset.
- Garantir que asset aprovado seja o mesmo que aparece publicamente.
- Criar/validar tela administrativa para revisar logos/assets enviados.
- Testar webhooks Stripe de assinatura, cancelamento, falha e concorrencia.

### Financeiro

Backend muito completo, mas com muitas rotas sem chamada direta detectada:

- `/financial/summary`
- `/financial/statement`
- `/financial/receivables`
- `/financial/payables`
- `/financial/refunds`
- `/financial/dre`
- `/financial/reconciliation`
- `/financial/payouts`
- `/financial/disputes`
- `/financial/export`
- `/financial/cost-centers`
- `/financial/categories`
- `/financial/chargebacks`
- `/financial/settings/financial`
- `/financial/stripe/status`
- `/financial/stripe/dashboard-link`

Pendencias:

- Confirmar se existe tela completa para cada fluxo financeiro.
- Validar permissao por papel e tenant.
- Homologar Stripe em modo live antes de producao.
- Testar estornos, chargebacks, repasses, DRE, conciliacao e exportacao.

### Monitoramento, auditoria e operacao

Pendencias:

- Validar telas para `/monitoring/*`, `/master/monitoring/*`, `/audit-logs/*`.
- Garantir que frontend consiga reportar erro para `frontend-error`.
- Confirmar se backup full tem protecao master, auditoria e estrategia de armazenamento.
- Criar/validar UI para outbound webhooks se a operacao nacional for usar integracoes externas.

### Eventos, teatro, totem e ingressos

Pendencias:

- Validar `event-operations`: capacidade, fila, wallet/pass, check-in e overbooking.
- Conferir telas de teatro sem API direta: playbill, elenco, cue master, mobile box office, seat editor e subscriptions.
- Validar sincronizacao offline do totem e PIN de saida.
- Testar compra, cancelamento, transferencia e validacao de ingresso ponta a ponta.

### Internacionalizacao e textos

Pendencias:

- Arquivos `pt-br.json`, `es.json` e `en.json` contem muitos placeholders e TODOs.
- Ha varios textos com encoding quebrado no frontend.
- Antes de expansao nacional, padronizar PT-BR e preparar base para acessibilidade e leitura publica.

## Ordem recomendada de execucao

1. Corrigir rotas duplicadas (`roteiro` e `my-sponsorships`).
2. Resolver o modelo unico/final de patrocinio e assets.
3. Remover `@ts-nocheck` das 20 telas mais criticas.
4. Adicionar validacao forte nos 20 formularios mais sensiveis.
5. Reconciliar rotas backend sem UI: financeiro, monitoramento, auditoria, webhooks, membership card, event operations.
6. Rodar build, typecheck, lint e testes dos fluxos criticos.
7. Fazer homologacao funcional por papel: visitante, admin equipamento, municipal, master, produtor, prestador, patrocinador, totem.
8. Fazer homologacao de producao: Stripe live, SMTP, storage/R2, Redis/jobs, webhooks, backup, logs, permissao e LGPD.

## Conclusao

O sistema esta grande, rico e bem mais conectado do que parecia no inicio. Mas ainda nao esta no estado que eu chamaria de "pronto nacional sem ressalvas".

O proximo passo certo e atacar primeiro as pendencias de rota e patrocinio, depois typecheck/validacao dos formularios criticos, e por fim homologar modulo por modulo com testes reais de fluxo.
