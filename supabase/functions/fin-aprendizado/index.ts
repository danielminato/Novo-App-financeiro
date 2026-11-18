// =====================================================================================
//  Il Fortunato — Financeiro · Aprendizado (conversa com a IA)
//  Supabase Edge Function "fin-aprendizado".
//
//  • Só o administrador master pode usar (confirmado na base com o login de quem chama).
//  • A IA lê os dados com o login de quem chama (as regras de acesso da base valem).
//  • A IA NUNCA altera dados: só PROPÕE. A app mostra a proposta e só o Daniel a aplica.
//  • As lições (fin_licoes) entram no início de cada conversa.
//
//  Segredo necessário (Supabase → Edge Functions → Secrets): ANTHROPIC_API_KEY
// =====================================================================================
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// chave pública: a que a app envia no cabeçalho "apikey" (publishable); senão a antiga anon
let CHAVE_PUBLICA = Deno.env.get("SUPABASE_ANON_KEY") || "";
const MODELO = "claude-opus-5-5";
const MAX_VOLTAS = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Tabelas que a IA pode ler e (via proposta) sugerir alterar
const LEITURA = [
  "fin_vendas_dia", "fin_compras", "fin_categorias", "fin_subcategorias", "fin_centros_custo",
  "fin_formas_pagamento", "fin_canais", "fin_metas", "fin_config", "fin_regras", "fin_iva_taxas",
  "fin_iva_meses", "fin_licoes",
];
const ALTERAVEIS = [
  "fin_compras", "fin_vendas_dia", "fin_categorias", "fin_subcategorias", "fin_centros_custo",
  "fin_formas_pagamento", "fin_regras", "fin_metas",
];

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "consultar",
    description:
      "Lê registos de uma tabela do financeiro (só leitura). 'parametros' é uma query PostgREST sem o '?', " +
      "por ex. 'select=data,valor,fornecedor&data=gte.2026-10-01&data=lt.2026-11-01&order=valor.desc'. " +
      "Filtros: eq, neq, gt, gte, lt, lte, like, ilike (use * como coringa), in.(a,b), is.null. Máximo 500 linhas por consulta.",
    input_schema: {
      type: "object",
      properties: {
        tabela: { type: "string", enum: LEITURA },
        parametros: { type: "string", description: "Query PostgREST, ex.: select=*&data=gte.2026-10-01" },
      },
      required: ["tabela", "parametros"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "resumo_mes",
    description:
      "Calcula os números de um mês exatamente como a app: faturamento, despesas por categoria, resultado, CMV %, " +
      "média diária, gorjetas, vendas por canal e IVA das compras.",
    input_schema: {
      type: "object",
      properties: { mes: { type: "string", description: "AAAA-MM" } },
      required: ["mes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "guardar_licao",
    description:
      "Guarda uma lição que o Daniel ensinou (regra de negócio, preferência, como classificar algo). Use quando ele " +
      "pedir para lembrar/aprender algo, ou confirmar que quer guardar. Escreva a lição curta, clara e autossuficiente.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propor_alteracao",
    description:
      "Propõe uma alteração de dados. NÃO altera nada: a app mostra a proposta ao Daniel com um botão para confirmar. " +
      "Use um filtro específico (por id: 'id=in.(12,15)' ou 'id=eq.7'); nunca alterações em massa sem filtro. " +
      "Não é possível apagar registos.",
    input_schema: {
      type: "object",
      properties: {
        descricao: { type: "string", description: "O que muda e porquê, em linguagem simples" },
        tabela: { type: "string", enum: ALTERAVEIS },
        filtro: { type: "string", description: "Filtro PostgREST, ex.: id=in.(12,15)" },
        mudancas: { type: "string", description: "Objeto JSON com os campos novos, ex.: {\"categoria_id\":1}" },
      },
      required: ["descricao", "tabela", "filtro", "mudancas"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function rest(jwt: string, caminho: string, init?: RequestInit) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: CHAVE_PUBLICA, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

async function resumoMes(jwt: string, mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error("mes deve ser AAAA-MM");
  const [a, m] = mes.split("-").map(Number);
  const fim = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  const [vendas, compras, cats] = await Promise.all([
    rest(jwt, `fin_vendas_dia?select=*&data=gte.${mes}-01&data=lt.${fim}`),
    rest(jwt, `fin_compras?select=valor,valor_iva,categoria_id&data=gte.${mes}-01&data=lt.${fim}`),
    rest(jwt, "fin_categorias?select=id,nome"),
  ]);
  const fatDia = (v: Record<string, unknown>) => n(v.sistema) + n(v.m20) + n(v.uber) + n(v.bolt) + n(v.glovo);
  const fat = vendas.reduce((s: number, v: Record<string, unknown>) => s + fatDia(v), 0);
  const dias = vendas.filter((v: Record<string, unknown>) => fatDia(v) > 0).length;
  const porCat: Record<string, number> = {};
  let desp = 0, iva = 0, cmv = 0;
  for (const c of compras) {
    const nome = (cats.find((x: { id: number }) => x.id === c.categoria_id) || {}).nome || "Sem categoria";
    porCat[nome] = r2((porCat[nome] || 0) + n(c.valor));
    desp += n(c.valor); iva += n(c.valor_iva);
    if (c.categoria_id === 1) cmv += n(c.valor);
  }
  const soma = (k: string) => r2(vendas.reduce((s: number, v: Record<string, unknown>) => s + n(v[k]), 0));
  return {
    mes, faturamento: r2(fat), despesas: r2(desp), resultado: r2(fat - desp),
    cmv: r2(cmv), cmv_percentual: fat ? r2(cmv / fat * 100) : 0,
    dias_com_venda: dias, media_diaria: dias ? r2(fat / dias) : 0, gorjetas: soma("gorjetas"),
    canais: { sistema: soma("sistema"), m20: soma("m20"), uber: soma("uber"), bolt: soma("bolt"), glovo: soma("glovo") },
    despesas_por_categoria: porCat, iva_compras: r2(iva), numero_compras: compras.length,
  };
}

function sistema(licoes: { texto: string }[], hoje: string) {
  return `És o assistente financeiro do restaurante Il Fortunato (Portugal), dentro da app "Financeiro".
Falas com o Daniel, sócio e administrador master. Responde em português de Portugal, de forma direta e curta,
com valores em euros (formato 1 234,56 €). Hoje é ${hoje}.

O teu papel: responder a perguntas sobre os números, encontrar erros e incoerências nos lançamentos,
aprender as regras do negócio que o Daniel te ensina, e propor correções.

Como a app calcula (usa sempre estas regras):
- Vendas (fin_vendas_dia, uma linha por dia): Total A = dinheiro + cartoes − gorjetas; Total B = sistema + m20;
  Diferença de caixa = A − B (ideal 0). Faturamento = sistema + m20 + uber + bolt + glovo. Gorjetas são da equipa
  e não entram no faturamento.
- Compras (fin_compras): valor = total com IVA; valor_iva = IVA contido. O mês conta pela "data" (data da compra);
  data_pagamento é quando foi paga. categoria_id 1 = CMV.
- Painel/Fluxo/DRE: Despesas = soma das compras do mês; Resultado = Faturamento − Despesas;
  CMV % = compras CMV ÷ faturamento (referência saudável ~30%).
  DRE: grupos pela categoria (CMV; Impostos; Financeiras; Distribuição de lucros; o resto são operacionais).
- IVA: débito = Σ base × taxa (bases em fin_iva_meses.bases por id de taxa); sem bases = estimativa com o
  IVA das vendas de fin_config (iva_vendas_percentual) incluído no faturamento; crédito = IVA das compras do mês.
- Listas: fin_categorias, fin_subcategorias (iva_percentual), fin_centros_custo (áreas), fin_formas_pagamento
  (as compras guardam o NOME da forma), fin_canais, fin_metas (meta_vendas = receita), fin_regras.

Ferramentas: para números de um mês usa resumo_mes (é exato); para detalhes usa consultar.
Nunca inventes números: se não consultaste, diz que não sabes.
Tu não alteras dados. Quando algo deve mudar, usa propor_alteracao com ids específicos — o Daniel confirma na app.
Quando o Daniel te ensina uma regra ou preferência, confirma em uma frase e guarda-a com guardar_licao.

Lições que o Daniel já te ensinou (segue-as):
${licoes.length ? licoes.map((l, i) => `${i + 1}. ${l.texto}`).join("\n") : "(ainda nenhuma)"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ erro: "sem sessão" }, 401);
  const apikey = req.headers.get("apikey");
  if (apikey && apikey.startsWith("sb_publishable_")) CHAVE_PUBLICA = apikey;

  try {
    // Só o master
    const nivel = await rest(jwt, "rpc/nivel_atual", { method: "POST", body: "{}" });
    if (nivel !== "master") return json({ erro: "Só o administrador master usa o Aprendizado." }, 403);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ erro: "Falta configurar a chave ANTHROPIC_API_KEY nos segredos das Edge Functions." }, 500);

    const corpo = await req.json();
    const mensagens: Anthropic.Beta.BetaMessageParam[] = Array.isArray(corpo.mensagens) ? corpo.mensagens : [];
    if (!mensagens.length || mensagens[mensagens.length - 1].role !== "user") return json({ erro: "falta a mensagem" }, 400);
    const inicio = mensagens.length;

    const licoes = await rest(jwt, "fin_licoes?select=texto&ativo=is.true&order=id");
    const hoje = new Date().toISOString().slice(0, 10);
    const client = new Anthropic();
    const propostas: unknown[] = [];

    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const resp = await client.beta.messages.create({
        model: MODELO,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        // @ts-ignore — parâmetro da beta de fallback (resposta noutro modelo se este recusar)
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [{ type: "text", text: sistema(licoes, hoje), cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages: mensagens,
      });
      // o conteúdo volta inteiro (inclui blocos de raciocínio, que têm de ser devolvidos tal como vieram)
      mensagens.push({ role: "assistant", content: resp.content as Anthropic.Beta.BetaContentBlockParam[] });

      if (resp.stop_reason === "pause_turn") continue;
      if (resp.stop_reason !== "tool_use") break;   // end_turn, max_tokens, refusal…

      const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const b of resp.content) {
        if (b.type !== "tool_use") continue;
        const inp = b.input as Record<string, string>;
        let out: string, erro = false;
        try {
          if (b.name === "consultar") {
            if (!LEITURA.includes(inp.tabela)) throw new Error("tabela não permitida");
            let p = String(inp.parametros || "").replace(/^\?/, "");
            if (!/(^|&)limit=/.test(p)) p += (p ? "&" : "") + "limit=500";
            p = p.replace(/(^|&)limit=(\d+)/, (_m, a, x) => `${a}limit=${Math.min(Number(x), 500)}`);
            const linhas = await rest(jwt, `${inp.tabela}?${p}`);
            out = JSON.stringify(linhas);
            if (out.length > 60000) out = out.slice(0, 60000) + " …(cortado: peça menos colunas ou um filtro mais estreito)";
          } else if (b.name === "resumo_mes") {
            out = JSON.stringify(await resumoMes(jwt, inp.mes));
          } else if (b.name === "guardar_licao") {
            const [l] = await rest(jwt, "fin_licoes", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ texto: String(inp.texto).trim() }) });
            out = `Lição guardada (nº ${l.id}).`;
          } else if (b.name === "propor_alteracao") {
            if (!ALTERAVEIS.includes(inp.tabela)) throw new Error("tabela não permitida");
            if (!/(^|&)[a-z_]+=(eq|in)\./.test(inp.filtro || "")) throw new Error("o filtro tem de usar eq. ou in. (ex.: id=in.(1,2))");
            const mudancas = JSON.parse(inp.mudancas);
            if (!mudancas || typeof mudancas !== "object" || Array.isArray(mudancas)) throw new Error("mudancas tem de ser um objeto JSON");
            const afetados = await rest(jwt, `${inp.tabela}?select=*&${inp.filtro}&limit=200`);
            propostas.push({ id: b.id, descricao: inp.descricao, tabela: inp.tabela, filtro: inp.filtro, mudancas, registos: afetados.length, estado: "pendente" });
            out = `Proposta mostrada ao Daniel (${afetados.length} registo(s)). Só é aplicada se ele confirmar na app; não digas que já foi feita.`;
          } else throw new Error("ferramenta desconhecida");
        } catch (e) { out = "Erro: " + (e as Error).message; erro = true; }
        resultados.push({ type: "tool_result", tool_use_id: b.id, content: out, ...(erro ? { is_error: true } : {}) });
      }
      mensagens.push({ role: "user", content: resultados });
    }

    return json({ novas: mensagens.slice(inicio), propostas });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ erro: "A chave ANTHROPIC_API_KEY não é válida." }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ erro: "Muitos pedidos à IA agora. Tente daqui a um minuto." }, 429);
    if (e instanceof Anthropic.APIError) return json({ erro: `Erro da IA (${e.status}): ${e.message}` }, 502);
    return json({ erro: (e as Error).message }, 500);
  }
});
