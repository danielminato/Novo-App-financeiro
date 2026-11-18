# Il Fortunato — Financeiro (app nova)

## O que é
Reconstrução do sistema financeiro que hoje corre em `il-fortunato.onrender.com` (feito por
outra pessoa com outro Claude, sem acesso ao código). Começa como **app separada** a pedido do
Daniel; **mais tarde integra-se na app de estoque**
(`danielminato/Controle-de-Estoque---Produ-o---Tarefas`).

Publicada em GitHub Pages: `https://danielminato.github.io/Novo-App-financeiro/`

## Decisões que tornam a integração fácil
- **Mesmo formato** da app de estoque: um `index.html`, HTML/CSS/JS puro, sem build.
- **Mesma base Supabase** (`oenaolbgjqkyzqjxmfzo`) e **mesmos logins**. Só entram administradores
  (tabela `admins`); o nível `master`/`admin` vem de `admins.nivel`.
- **Tabelas com prefixo `fin_`** — a app nova nunca toca nas tabelas da app de estoque.
- **Cor**: verde (`--verde`, `--verde-escuro`), para distinguir da app de estoque (azul).
  Na integração, as variáveis passam a ser as da app principal.

## Perfis e segurança (já ativos na base, 18/11/2026)
Ver `migracoes/2026-11-18_perfis_master.sql` no repositório da app de estoque. O adm (não
master) lança e corrige, mas não apaga nem mexe na estrutura; tentativas ficam em
`alertas_seguranca`. **Sempre que se criarem tabelas `fin_*`, voltar a correr o bloco 6 dessa
migração**, e acrescentar as de estrutura (categorias, centros de custo, regras…) à lista
`estrutura`.

## Dados copiados do sistema atual (backup, 18/11/2026)
Fora do repositório (este repositório é público — dados financeiros nunca entram aqui):
`C:\Users\Daniel Minato\IlFortunato-GitHub\Claude outputs\financeiro-render\`
- `render-financeiro-dados.json` — 139 dias de vendas, 252 compras (todos os campos),
  taxas e acertos de IVA, utilizadores (sem senhas).
- `render-financeiro-paginas.json` — HTML de todas as páginas (painel, DRE, fluxo, IVA,
  metas, regras…) de ago/2025 e mai–nov/2026. *Pendente: o Chrome bloqueou o download.*

Cuidado combinado com o Daniel: **não voltar a ler o sistema do Render em massa** (deixa rasto
nos registos de quem o mantém). Para validar números, ler só páginas pontuais ou usar
exportações/prints que ele envie.

## Secções (iguais às do sistema atual)
Painel · Vendas · Compras (com leitura de faturas por IA) · Aprendizado · Relatórios
(vendas, fluxo de caixa, DRE, IVA) · Conciliação bancária · Administração.

## Estado
- [x] Esqueleto: login, menu, tema verde
- [ ] Especificação das fórmulas (a partir das páginas copiadas)
- [x] Tabelas `fin_*` + importação do backup (18/11/2026: 139 vendas, 252 compras;
      faturamento 129 403,43 €, compras 115 835,45 € — igual ao sistema atual). Guarda de
      perfis e RLS ativas nas 8 tabelas.
- [x] Compras (lançar, corrigir, filtros, IVA sugerido)
- [ ] Compras: leitura de faturas por IA (Edge Function com `ANTHROPIC_API_KEY` nos secrets) e comprovantes
- [x] Vendas
- [ ] Painel e Relatórios
- [ ] Conciliação bancária
- [ ] Validação mês a mês contra o sistema atual
- [ ] Integração na app de estoque
