// Escritório dos agentes: recebe eventos dos hooks do Claude Code e mostra num escritório 3D.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import tls from 'node:tls';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');
const DADOS = path.join(RAIZ, 'data');
const HOST = process.env.HOST || '127.0.0.1';
const PORTA = Number(process.env.PORT || 4800);
const COOKIE_SEGURO = process.env.COOKIE_INSEGURO !== '1';
const LIMITE_EVENTO = 8 * 1024 * 1024;
const DURACAO_LOGIN_MS = 12 * 60 * 60 * 1000;

// ---------- configuração ----------
let config;
function carregarConfig() {
  config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
  config.setores ||= [];
  config.ocultos ||= [];
  try { config.minhaSala = JSON.parse(fs.readFileSync(path.join(DADOS, 'minha-sala.json'), 'utf8')); } catch { /* sala padrão */ }
}
carregarConfig();
fs.watchFile(path.join(RAIZ, 'config.json'), { interval: 2000 }, () => {
  try { carregarConfig(); compilarEspecialidades(); reprocessarSetores(); avisar(); } catch (e) { console.error('config.json inválido:', e.message); }
});

function lerTokenHook() {
  const arq = path.join(DADOS, 'hook-token');
  if (!fs.existsSync(arq)) {
    fs.mkdirSync(DADOS, { recursive: true, mode: 0o700 });
    fs.writeFileSync(arq, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(arq, 'utf8').trim();
}
const TOKEN_HOOK = lerTokenHook();

function lerAuth() {
  try { return JSON.parse(fs.readFileSync(path.join(DADOS, 'auth.json'), 'utf8')); } catch { return null; }
}

// ---------- setores ----------
const setoresDinamicos = new Map();

function setorDaPasta(cwd, maquina) {
  if (maquina) {
    // projeto em outra VPS: setor próprio com o nome da máquina
    const raizP = RAIZ_PROJETOS.replace(/\/$/, ''), c0 = String(cwd || '');
  const m = (c0.startsWith(raizP + '/') && c0.slice(raizP.length + 1).match(/^([^/]+)/)) || c0.match(/^\/(?:root|home\/[^/]+)\/(?:projetos\/)?([^/]+)/);
    const pasta = m ? m[1] : 'geral';
    const id = ('maq-' + maquina + '-' + pasta).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60);
    const conhecido = config.setores.find(x => (x.maquinas || []).includes(maquina) && (x.pastasRemotas || []).some(p => cwd === p || String(cwd).startsWith(p + '/')));
    if (conhecido) return conhecido.id;
    if (!setoresDinamicos.has(id)) setoresDinamicos.set(id, { id, nome: `${pasta} (${maquina})`, cor: '#444441', dinamico: true, maquina });
    return id;
  }
  if (!cwd) return 'recepcao';
  let melhor = null, tam = -1;
  for (const s of config.setores) {
    for (const p of s.pastas || []) {
      if ((cwd === p || cwd.startsWith(p + '/')) && p.length > tam) { melhor = s.id; tam = p.length; }
    }
  }
  if (melhor) return melhor;
  const raiz = RAIZ_PROJETOS.replace(/\/$/, ''), casa = os.homedir();
  const m = (cwd.startsWith(raiz + '/') && cwd.slice(raiz.length + 1).match(/^([^/]+)/)) || cwd.match(/^\/(?:root|home\/[^/]+)\/projetos\/([^/]+)/) || (cwd.startsWith(casa + '/') && cwd.slice(casa.length + 1).match(/^([^/]+)/));
  if (!m || ['projetos', path.basename(raiz)].includes(m[1])) return 'recepcao';
  const id = 'pasta-' + m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!setoresDinamicos.has(id)) setoresDinamicos.set(id, { id, nome: m[1], cor: '#5F5E5A', dinamico: true });
  return id;
}

// grava JSON de forma atômica: se o servidor cair no meio, o arquivo antigo continua inteiro
const INICIO = Date.now();
const EMPRESA = () => config.empresa || 'empresa';
// pasta de configuração de cada conta do Claude ('' = a padrão, ~/.claude)
const dirConta = conta => (config.contas || { pessoal: '' })[conta] || '';
const envConta = conta => dirConta(conta) ? ['--setenv=CLAUDE_CONFIG_DIR=' + dirConta(conta)] : [];
const gravandoJSON = new Map();
function gravarJSON(arq, dados, espaco) {
  const texto = JSON.stringify(dados, null, espaco);
  if (gravandoJSON.has(arq)) { gravandoJSON.set(arq, texto); return; } // junta gravações seguidas
  gravandoJSON.set(arq, texto);
  const proxima = () => {
    const t = gravandoJSON.get(arq);
    fs.writeFile(arq + '.tmp', t, { mode: 0o600 }, e => {
      const fim = () => { if (gravandoJSON.get(arq) !== t) proxima(); else gravandoJSON.delete(arq); };
      if (e) { console.error('gravar', path.basename(arq) + ':', e.message); return fim(); }
      fs.rename(arq + '.tmp', arq, e2 => { if (e2) console.error('gravar', path.basename(arq) + ':', e2.message); fim(); });
    });
  };
  proxima();
}

const servidoresDeProducao = () => (config.servidores || []).filter(g => (g.tipo || 'producao') === 'producao').map(g => g.nome).slice(0, 4).join(', ');

// setores com as pastas (listaSetores() devolve só id, nome e cor para a tela)
const setoresComPastas = () => config.setores || [];
function listaSetores() {
  return [...config.setores.map(({ id, nome, cor }) => ({ id, nome, cor })), ...setoresDinamicos.values()]
    .filter(s => !config.ocultos.includes(s.id));
}

// ---------- sessões ----------
const sessoes = new Map();
const NOMES = ['Ana', 'Bia', 'Caio', 'Duda', 'Enzo', 'Fê', 'Gabi', 'Hugo', 'Iara', 'João', 'Kika', 'Léo', 'Malu', 'Nina', 'Otto', 'Pri', 'Rafa', 'Sol', 'Theo', 'Vivi'];
let infoEspecialistas = {};
setTimeout(() => { infoEspecialistas = resumoEspecialistas(); }, 0);
setInterval(() => { infoEspecialistas = resumoEspecialistas(); }, 60_000);
let plano = null; // último plano apresentado (vai para a lousa da sala de reunião)
function nomeDe(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return NOMES[(h >>> 0) % NOMES.length];
}

// ---------- papelada (relatórios entregues na mesa da diretoria) ----------
const ARQ_RELATORIOS = path.join(DADOS, 'relatorios.json');
const MAX_RELATORIOS = 300;
let relatorios = [];
try { relatorios = JSON.parse(fs.readFileSync(ARQ_RELATORIOS, 'utf8')); } catch { relatorios = []; }
let gravacaoPendente = null, versaoRelatorios = 0;
function gravarRelatorios() {
  versaoRelatorios++;
  clearTimeout(gravacaoPendente);
  gravacaoPendente = setTimeout(() => {
    fs.writeFile(ARQ_RELATORIOS + '.tmp', JSON.stringify(relatorios), { mode: 0o600 }, e => {
      if (!e) fs.rename(ARQ_RELATORIOS + '.tmp', ARQ_RELATORIOS, () => {});
    });
  }, 500);
}

const historicoValido = arq => !!arq && /^\/root\/\.claude(-empresa)?\/[^\0]+\.jsonl$/.test(arq) && !arq.includes('..');
async function tamanhoHistorico(arq) {
  if (!historicoValido(arq)) return 0;
  try { return (await fs.promises.stat(arq)).size; } catch { return 0; }
}

// lê a tarefa no histórico da sessão: a última resposta do agente e os tokens gastos desde `desde`
async function lerTarefa(arq, desde) {
  const vazio = { resposta: '', tokens: { entrada: 0, saida: 0, cache: 0 }, porModelo: {} };
  if (!historicoValido(arq)) return vazio;
  let fh;
  try {
    fh = await fs.promises.open(arq, 'r');
    const { size } = await fh.stat();
    const inicio = Math.max(desde || 0, size - 30_000_000, 0);
    const tam = size - inicio;
    const buf = Buffer.alloc(tam);
    await fh.read(buf, 0, tam, inicio);
    const linhas = buf.toString('utf8').split('\n');
    if (inicio > 0 && inicio !== desde) linhas.shift();
    const tokens = { entrada: 0, saida: 0, cache: 0 }, porModelo = {}, vistos = new Set(), entradas = [];
    for (const l of linhas) {
      let e;
      try { e = JSON.parse(l); } catch { continue; }
      entradas.push(e);
      const u = e.type === 'assistant' && e.message?.usage;
      if (u && !vistos.has(e.message.id)) {
        vistos.add(e.message.id);
        tokens.entrada += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        tokens.cache += u.cache_read_input_tokens || 0;
        tokens.saida += u.output_tokens || 0;
        const m = (porModelo[e.message.model || 'desconhecido'] ||= { entrada: 0, escritaCache: 0, leituraCache: 0, saida: 0 });
        m.entrada += u.input_tokens || 0; m.escritaCache += u.cache_creation_input_tokens || 0;
        m.leituraCache += u.cache_read_input_tokens || 0; m.saida += u.output_tokens || 0;
      }
    }
    const partes = [];
    for (let i = entradas.length - 1; i >= 0; i--) {
      const e = entradas[i];
      if (e.type === 'assistant') {
        const c = e.message?.content;
        const t = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '');
        if (t.trim()) partes.unshift(t.trim());
      } else if (e.type === 'user' && partes.length) break;
    }
    return { resposta: partes.join('\n\n'), tokens, porModelo };
  } catch { return vazio; } finally { await fh?.close(); }
}

const NIVEIS = [[0, 'Estagiário'], [2, 'Júnior'], [5, 'Pleno'], [10, 'Sênior'], [20, 'Especialista']];
const nivelDe = n => NIVEIS.filter(([min]) => n >= min).pop()[1];
function atualizarNivel(s) {
  s.entregas = relatorios.filter(r => r.sessao === s.id).length;
  s.nivel = nivelDe(s.entregas);
}

async function criarRelatorio(s, ev) {
  const t = s.tarefa || { pedido: '', inicio: s.desdeEstado, arquivos: [], comandos: 0, ferramentas: 0, desde: 0 };
  s.tarefa = null;
  await new Promise(r => setTimeout(r, 1500));
  const lido = await lerTarefa(ev.transcript_path, t.desde);
  const resposta = ev.last_assistant_message || lido.resposta;
  if (!resposta && !t.ferramentas && !t.pedido) return;
  const o = s.ordem ? ordens.get(s.ordem) : null;
  const rel = {
    id: crypto.randomUUID(), sessao: s.id, agente: s.nome, conta: s.conta, setor: s.setor, cwd: s.cwd,
    pedido: censurarTexto(o?.pedidoVisivel || t.pedido).slice(0, 3000), resposta: censurarTexto(resposta).slice(0, 8000),
    arquivos: t.arquivos.slice(0, 60), comandos: t.comandos, ferramentas: t.ferramentas, tokens: lido.tokens, porModelo: lido.porModelo,
    custoUSD: custoDe(lido.porModelo), ordem: s.ordem || null, modo: o?.modo || 'executar', anexos: o?.anexos || [],
    especialidade: s.especialidade, projeto: o?.tarefa || null, origem: o?.origem || null,
    inicio: t.inicio, fim: Date.now(), lido: false,
  };
  relatorios.unshift(rel);
  relatorios.length = Math.min(relatorios.length, MAX_RELATORIOS);
  registrarMemoria(rel);
  resumir(rel).catch(e => console.error('resumo:', e.message));
  // revisão do QA antes de chegar na mesa: só trabalho do escritório que mexeu em arquivos
  const revisar = config.revisaoQA !== false && o && o.modo === 'executar' && !o.autorizarDeploy && rel.arquivos.length && (o.revisoes || 0) < 2;
  if (revisar) {
    rel.emRevisao = true; rel.lido = true;
    gravarRelatorios(); avisar();
    revisarComQA(rel, s, o).catch(e => { console.error('revisão:', e.message); rel.emRevisao = false; entregar(rel, s); });
    return;
  }
  gravarRelatorios();
  entregar(rel, s);
}

// entrega na mesa da dona: animação, avisos, conquistas e andamento do projeto
function entregar(rel, s) {
  rel.lido = false;
  if (rel.ordem) for (const m of metas) for (const ps of m.passos) if (ps.ordem === rel.ordem && ps.status !== 'feito') { ps.status = 'feito'; ps.feito = Date.now(); ps.relatorio = rel.id; gravarMetas(); }
  const oPub = rel.ordem && ordens.get(rel.ordem);
  if (oPub?.deploy) { const dep = deploys.find(x => x.id === oPub.deploy); if (dep && dep.status === 'publicando') { dep.status = 'publicado'; dep.relatorio = rel.id; dep.fim = Date.now(); gravarDeploys(); } }
  if (s) { s.entrega = { id: rel.id, em: Date.now() }; atualizarNivel(s); verificarConquistas(s); }
  gravarRelatorios(); avisar();
  if (rel.projeto) concluirTarefaDeProjeto(rel);
  const avisarDepois = () => {
    const titulo = rel.simples?.titulo || curto(rel.pedido || 'tarefa', 80);
    const status = { atencao: ' (precisa de atenção)', problema: ' (deu problema)' }[rel.simples?.resultado?.status] || '';
    notificar('entrega', `${rel.agente} entregou: ${titulo}${status} · ${nomeSetor(rel.setor)}${rel.simples?.resumo ? '\n\n' + rel.simples.resumo : ''}`);
  };
  if (rel.simples) avisarDepois(); else setTimeout(avisarDepois, 25_000);
}

// ---------- revisão do QA ----------
const revisoesAtivas = new Map(); // relatório -> { setor, agente, em }
async function revisarComQA(rel, s, o) {
  revisoesAtivas.set(rel.id, { setor: rel.setor, agente: rel.agente, sessao: rel.sessao, em: Date.now() });
  avisar();
  const esp = lerEspecialista('testes');
  const prompt = `Revise o trabalho que um colega acabou de fazer neste projeto. NÃO altere arquivos: só leia, rode comandos de verificação e julgue.
Pedido original: ${rel.pedido.slice(0, 1500)}
Resposta do colega: ${rel.resposta.slice(0, 4000)}
Arquivos alterados: ${rel.arquivos.join(', ')}
Passos: 1) veja as mudanças com git diff / git status (se for repositório) ou lendo os arquivos; 2) rode os testes, lint ou build que o projeto tiver e forem rápidos; 3) confira se o pedido foi atendido sem quebrar nada nem criar risco.
Seja justo: só reprove por problema real (bug, teste quebrando, pedido não atendido, risco de segurança), não por gosto.
Responda APENAS com JSON válido: {"aprovado": true|false, "resumo": "1 a 2 frases em português simples", "problemas": ["problema concreto e como corrigir", "..."]}`;
  const def = { description: 'Revisor de QA', prompt: `${contextoEmpresa()}\n\n---\n\n${esp?.manual || ''}`, model: config.modeloRevisao || 'sonnet', tools: ['Read', 'Grep', 'Glob', 'Bash'] };
  const r = await rodarClaudeLeitura(rel.cwd, rel.conta, prompt, { revisor: def }, 'revisor', 15 * 60_000);
  revisoesAtivas.delete(rel.id);
  let j = null;
  try { j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1)); } catch { /* sem veredito: entrega assim mesmo */ }
  rel.emRevisao = false;
  const rodada = (o.revisoes || 0) + 1;
  rel.revisao = j ? { aprovado: !!j.aprovado, resumo: censurarTexto(String(j.resumo || '')).slice(0, 500), problemas: (Array.isArray(j.problemas) ? j.problemas : []).slice(0, 6).map(x => censurarTexto(String(x)).slice(0, 400)), rodada, em: Date.now() }
    : { aprovado: true, resumo: 'O revisor não conseguiu dar um veredito; entregue sem revisão.', problemas: [], rodada, em: Date.now() };
  if (!rel.revisao.aprovado && rodada < 2 && sessoes.has(s.id)) {
    // devolve para o mesmo agente corrigir; o relatório corrigido passa por nova revisão
    rel.devolvido = true; rel.lido = true;
    gravarRelatorios(); avisar();
    const pedidoFix = `O revisor de QA encontrou problemas no que você acabou de fazer:\n${rel.revisao.problemas.map(x => '- ' + x).join('\n')}\n\nCorrija e confirme no final o que mudou.`;
    const r2 = await novaOrdem({ sessao: s.id, pedido: pedidoFix, modo: 'executar' }, 'qa', 'qa', { revisoes: rodada, tarefa: o.tarefa, pedidoVisivel: 'Correção pedida pelo QA' });
    if (r2.erro) { rel.devolvido = false; entregar(rel, s); }
    return;
  }
  entregar(rel, s);
}

// roda o Claude só para ler e responder (revisão, planejamento), sem hooks e sem virar robô
async function rodarClaudeLeitura(pasta, conta, prompt, agentes, agente, limite, dirs = []) {
  const args = ['--wait', '--pipe', '--collect', '--quiet', '--property=WorkingDirectory=' + pasta, `--property=RuntimeMaxSec=${Math.ceil(limite / 1000)}`,
    '--setenv=HOME=/root', '--setenv=ESCRITORIO_IGNORAR=1', '--setenv=PATH=' + (process.env.PATH || '/usr/local/bin:/usr/bin:/bin')];
  args.push(...envConta(conta));
  args.push(CLAUDE_BIN, '-p', prompt, '--agents', JSON.stringify(agentes), '--agent', agente, '--permission-mode', 'auto',
    ...dirs.filter(d => fs.existsSync(d)).flatMap(d => ['--add-dir', d]),
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text');
  const r = await rodar('systemd-run', args, null, limite + 30_000);
  return r.saida;
}

// ---------- memória do projeto no cofre (segundo cérebro) ----------
const COFRE = config.cofre || '/nao-configurado';
function prefixosCofre(setorId) { return config.setores.find(x => x.id === setorId)?.cofre || []; }
function notasDoProjeto(setorId) {
  const pre = prefixosCofre(setorId), dir = path.join(COFRE, '04-projetos'), lista = [];
  if (!pre.length) return lista;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!pre.some(p => f.startsWith(p))) continue;
      const cheio = path.join(dir, f);
      if (f.endsWith('.md')) lista.push(cheio);
      else if (fs.statSync(cheio).isDirectory()) {
        const mapa = fs.readdirSync(cheio).find(x => x.endsWith('-mapa.md'));
        lista.push(mapa ? path.join(cheio, mapa) : cheio + '/');
      }
    }
  } catch { /* cofre indisponível */ }
  return lista.slice(0, 14);
}
function notaEscritorio(setorId) {
  const pre = prefixosCofre(setorId)[0];
  return pre ? path.join(COFRE, '04-projetos', `${pre}-escritorio.md`) : null;
}
function anotarNoCofre(setorId, linhas) {
  const arq = notaEscritorio(setorId);
  if (!arq || !linhas.length || !fs.existsSync(COFRE)) return;
  const pre = prefixosCofre(setorId)[0], hoje = diaDe(Date.now());
  try {
    if (!fs.existsSync(arq)) {
      fs.writeFileSync(arq, `---\nname: ${pre}-escritorio\ndescription: Memória que os agentes do escritório acumulam sobre ${nomeSetor(setorId)} (decisões, armadilhas e lições das recusas)\natualizado: ${hoje}\n---\n\n# ${nomeSetor(setorId)}: memória do escritório\n\nRegistrado automaticamente pelo escritório dos agentes. Cada linha tem a data e quem registrou.\n\n`);
      const indice = path.join(COFRE, '00-indice-mestre.md');
      const linhaIndice = `- 04-projetos/[[${pre}-escritorio]]: memória acumulada pelos agentes do escritório sobre ${nomeSetor(setorId)} (decisões, armadilhas, lições das recusas)`;
      const txt = fs.readFileSync(indice, 'utf8');
      if (!txt.includes(`[[${pre}-escritorio]]`)) {
        const ls = txt.split('\n');
        let k = -1;
        ls.forEach((l, n) => { if (l.startsWith('- 04-projetos/[[' + pre)) k = n; });
        if (k < 0) ls.forEach((l, n) => { if (l.startsWith('- 04-projetos/')) k = n; });
        if (k >= 0) { ls.splice(k + 1, 0, linhaIndice); fs.writeFileSync(indice, ls.join('\n')); }
      }
    }
    let txt = fs.readFileSync(arq, 'utf8').replace(/^atualizado: .*$/m, `atualizado: ${hoje}`);
    txt = txt.trimEnd() + '\n' + linhas.map(l => `- ${hoje} · ${l}`).join('\n') + '\n';
    fs.writeFileSync(arq, txt);
  } catch (e) { console.error('cofre:', e.message); }
}
function registrarMemoria(rel) {
  const m = rel.resposta.match(/(?:^|\n)\s*(?:#{1,4}\s*|\*\*)Para lembrar(?:\*\*)?:?\s*\n([\s\S]*?)(?:\n\s*\n|\n#{1,4}\s|$)/i);
  if (!m) return;
  const itens = m[1].split('\n').map(l => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean).slice(0, 3);
  anotarNoCofre(rel.setor, itens.map(x => `${rel.agente} (${regrasPapel.find(e => e.id === rel.especialidade)?.nome || 'generalista'}): ${curto(x, 300)}`));
}

// ---------- custo em reais (preços oficiais por milhão de tokens, em USD) ----------
// [prefixo do id do modelo, entrada, saída, leitura de cache]; escrita de cache = 1,25 × entrada
const PRECOS_PADRAO = [
  ['claude-fable-5', 10, 50, 0.25], ['claude-mythos-5', 10, 50, 0.25], ['claude-opus-5-5', 4, 20, 0.2], ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4', 5, 25, 0.5], ['claude-sonnet-5', 2, 10, 0.2], ['claude-sonnet-4-6', 3, 15, 0.3], ['claude-sonnet-4', 3, 15, 0.3],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01], ['claude-haiku-4-5', 1, 5, 0.1],
];
function precoDe(modelo) {
  const tabela = config.precos || PRECOS_PADRAO;
  return tabela.find(([p]) => String(modelo).startsWith(p)) || null;
}
function custoDe(porModelo) {
  let usd = 0, estimado = false;
  for (const [modelo, u] of Object.entries(porModelo || {})) {
    let p = precoDe(modelo);
    if (!p) { p = precoDe('claude-sonnet-5'); estimado = true; }
    const [, ent, sai, lei] = p;
    usd += (u.entrada * ent + u.escritaCache * ent * 1.25 + u.leituraCache * lei + u.saida * sai) / 1e6;
  }
  return Math.round(usd * 10000) / 10000 + (estimado ? 0 : 0);
}
let cambio = { brl: config.cotacaoDolar || null, em: 0, fonte: config.cotacaoDolar ? 'config' : '' };
async function atualizarCambio() {
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10_000) })).json();
    if (j?.rates?.BRL) { cambio = { brl: j.rates.BRL, em: Date.now(), fonte: 'open.er-api.com' }; avisar(); }
  } catch (e) { console.error('câmbio:', e.message); }
}
setTimeout(atualizarCambio, 3000);
setInterval(atualizarCambio, 6 * 3600_000);

// ---------- aprovar ou refazer uma entrega ----------
async function avaliarEntrega(id, avaliacao, comentario) {
  const rel = relatorios.find(r => r.id === id);
  if (!rel) return { erro: 'Relatório não encontrado.' };
  comentario = String(comentario || '').trim().slice(0, 3000);
  if (avaliacao === 'aprovado') { rel.avaliacao = { tipo: 'aprovado', em: Date.now() }; gravarRelatorios(); avisar(); return { ok: true }; }
  if (avaliacao !== 'refazer') return { erro: 'Avaliação inválida.' };
  if (!comentario) return { erro: 'Diga o que precisa mudar.' };
  rel.avaliacao = { tipo: 'refazer', comentario: censurarTexto(comentario), em: Date.now() };
  gravarRelatorios(); avisar();
  // a recusa vira lição no cofre do projeto, para o próximo agente não repetir
  anotarNoCofre(rel.setor, [`Lição de uma recusa (${regrasPapel.find(e => e.id === rel.especialidade)?.nome || 'generalista'}): a dona pediu para refazer "${curto(semQuebra(rel.pedido), 120)}" porque: ${curto(semQuebra(comentario), 300)}`]);
  if (!sessoes.has(rel.sessao)) return { ok: true, aviso: 'O agente já foi embora; a lição ficou registrada. Mande uma tarefa nova para refazer.' };
  return novaOrdem({ sessao: rel.sessao, pedido: `A dona revisou a sua entrega e pediu para REFAZER.\nComentário dela: ${comentario}\n\nRefaça levando isso em conta e explique no final o que mudou.`, modo: 'executar' }, 'refazer', 'refazer', { pedidoVisivel: 'Refazer: ' + comentario });
}
const semQuebra = t => String(t || '').replace(/\s+/g, ' ').trim();

// ---------- gerente de projetos ----------
const ARQ_PROJETOS = path.join(DADOS, 'projetos.json');
let projetos = [];
try { projetos = JSON.parse(fs.readFileSync(ARQ_PROJETOS, 'utf8')); } catch { projetos = []; }
const gravarProjetos = () => gravarJSON(ARQ_PROJETOS, projetos);
const RAIZ_PROJETOS = config.raizProjetos || path.join(os.homedir(), 'projetos');
const CORES_SETOR = ['#0F6E56', '#185FA5', '#993C1D', '#534AB7', '#3B6D11', '#993556', '#854F0B', '#0C447C', '#A32D2D', '#3C3489', '#27500A', '#72243E'];
const FERRAMENTAS_OK = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite', 'NotebookEdit', 'Agent'];
const slugDe = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function novoProjeto({ setor, pedido, conta, novo }) {
  let pasta, slug = null;
  if (novo) {
    // projeto do zero: a pasta e o setor só são criados quando você aprovar o plano
    slug = slugDe(novo.nome);
    if (!slug || slug.length < 2) return { erro: 'Dê um nome para o projeto novo.' };
    if (fs.existsSync(path.join(RAIZ_PROJETOS, slug))) return { erro: `Já existe uma pasta "${slug}" em ${RAIZ_PROJETOS}. Escolha outro nome ou use o projeto existente.` };
    if (config.setores.some(x => x.id === slug)) return { erro: 'Já existe um setor com esse nome.' };
    pasta = RAIZ_PROJETOS;
    setor = slug;
  } else {
    pasta = pastaDoSetor(setor);
    if (!pasta) return { erro: 'Setor sem pasta válida.' };
  }
  pedido = String(pedido || '').trim();
  if (pedido.length < 10 || pedido.length > 8000) return { erro: 'Descreva o projeto (entre 10 e 8000 caracteres).' };
  if (!['pessoal', 'empresa'].includes(conta)) return { erro: 'Conta inválida.' };
  if (!(await contaLogada(conta))) return { erro: `A conta ${conta} do Claude não está logada pela assinatura na VPS.` };
  if (projetos.filter(p => ['planejando', 'executando'].includes(p.status)).length >= 3) return { erro: 'Já tem 3 projetos em andamento.' };
  const p = { id: crypto.randomBytes(6).toString('hex'), setor, pasta, conta, pedido, titulo: novo ? String(novo.nome).slice(0, 60) : curto(semQuebra(pedido), 70),
    novo: novo ? { nome: String(novo.nome).slice(0, 60), slug, pasta: path.join(RAIZ_PROJETOS, slug) } : null, status: 'planejando', tarefas: [], criado: Date.now() };
  projetos.unshift(p); projetos.length = Math.min(projetos.length, 50);
  gravarProjetos(); avisar();
  planejarProjeto(p).catch(e => { p.status = 'erro'; p.erro = 'O gerente não conseguiu planejar: ' + e.message; gravarProjetos(); avisar(); });
  return { ok: true, id: p.id };
}
async function planejarProjeto(p) {
  const lista = regrasPapel.map(e => `- ${e.id}: ${e.nome} — ${lerEspecialista(e.id)?.descricao || ''}`).join('\n');
  const notas = p.novo ? [] : notasDoProjeto(p.setor);
  const contexto = p.novo
    ? `É um PROJETO NOVO, do zero: "${p.novo.nome}". A pasta ${p.novo.pasta} será criada vazia quando a dona aprovar. Escolha a stack mais adequada (prefira tecnologias que a casa já usa, se servirem). A primeira tarefa deve criar a estrutura inicial do projeto, um README e inicializar o git.`
    : `Projeto existente em ${p.pasta}. Leia o que precisar para entender (não execute nada).`;
  const prompt = `Você é o GERENTE DE PROJETOS da ${EMPRESA()}. Planeje, NÃO execute.
${contexto}
Pedido da dona: ${p.pedido}
${notas.length ? `Notas do cofre deste projeto (leia as relevantes): ${notas.join(', ')}` : ''}
${p.refinamento ? `\nO PO do produto já refinou o pedido (siga estas histórias e critérios):\n${JSON.stringify(p.refinamento).slice(0, 4000)}\n` : ''}
Especialistas que a casa já tem:
${lista}

1) Defina a stack (linguagens, frameworks, banco, infra).
2) Se alguma parte importante da stack NÃO for coberta pelos especialistas acima, proponha contratar especialistas novos (no máximo 4). Não crie especialista que duplique um existente.
   Cada novo precisa de: id (minúsculas e hífen, único), nome, cor (#RRGGBB), modelo (sonnet, opus ou haiku), ferramentas ("todas" ou lista entre ${FERRAMENTAS_OK.join(', ')}), descricao (1 frase), manual (em Markdown, em português, no estilo dos manuais da casa: "Você é o especialista em X da ${EMPRESA()}", padrões, checklist, o que nunca fazer; 15 a 40 linhas), arquivos (regex JS que reconhece arquivos dessa área, ou vazio) e comandos (regex JS de comandos de terminal dessa área, ou vazio).
3) Quebre o trabalho em 2 a 8 tarefas pequenas, em ordem lógica, cada uma para um especialista (existente ou novo). Use dependências quando uma precisa da outra. Inclua uma tarefa final de testes quando houver código.
   Cada "pedido" deve ser completo e autoexplicativo (o especialista não vê as outras tarefas), com arquivos/telas envolvidos e critério de pronto.

Responda APENAS JSON válido:
{"titulo": "nome curto", "resumo": "2 frases em português simples", "stack": ["tecnologia", "..."],
 "novosEspecialistas": [{"id": "...", "nome": "...", "cor": "#...", "modelo": "sonnet", "ferramentas": "todas", "descricao": "...", "manual": "...", "arquivos": "...", "comandos": "..."}],
 "tarefas": [{"titulo": "curto", "especialista": "id", "pedido": "instrução completa", "depende": [índices anteriores, começando em 0]}]}`;
  if (!p.novo && temPO(p.setor) && !p.refinamento) {
    plano = { texto: `Refinando: ${p.titulo}\n\nO PO de ${nomeSetor(p.setor)} está transformando o pedido em histórias com critérios de pronto.`, agente: nomePO(p.setor), setor: p.setor, em: Date.now() };
    avisar();
    p.refinamento = await refinarComPO(p).catch(() => null);
    gravarProjetos(); avisar();
  }
  const def = { description: 'Gerente de projetos', prompt: contextoEmpresa(), model: config.modeloGerente || 'opus', tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'] };
  plano = { texto: `Planejando: ${p.titulo}\n\nO gerente está ${p.novo ? 'escolhendo a stack e montando a equipe' : 'lendo o projeto e dividindo o trabalho'}.`, agente: 'Gerente', setor: p.setor, em: Date.now() };
  avisar();
  const r = await rodarClaudeLeitura(p.pasta, p.conta, prompt, { gerente: def }, 'gerente', 15 * 60_000);
  let j;
  try { j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1)); } catch { throw new Error('resposta sem plano'); }
  // especialistas novos propostos (validados; só são criados quando você aprovar)
  const novos = [];
  for (const e of (Array.isArray(j.novosEspecialistas) ? j.novosEspecialistas : []).slice(0, 4)) {
    const id = slugDe(e.id);
    if (!id || especialidadeExiste(id) || novos.some(x => x.id === id) || id === 'gerente' || id === 'generalista') continue;
    const ok = rx => { if (!rx) return ''; try { new RegExp(rx, 'i'); return String(rx).slice(0, 300); } catch { return ''; } };
    const ferr = e.ferramentas === 'todas' || !Array.isArray(e.ferramentas) ? 'todas' : e.ferramentas.filter(f => FERRAMENTAS_OK.includes(f));
    novos.push({ id, nome: curto(semQuebra(e.nome), 40) || id, cor: /^#[0-9a-f]{6}$/i.test(e.cor || '') ? e.cor : CORES_SETOR[novos.length % CORES_SETOR.length],
      modelo: ['sonnet', 'opus', 'haiku'].includes(e.modelo) ? e.modelo : 'sonnet', ferramentas: ferr === 'todas' || !ferr.length ? 'todas' : ferr,
      descricao: curto(semQuebra(e.descricao), 160), manual: String(e.manual || '').replace(/^---[\s\S]*?---/, '').slice(0, 6000).trim(),
      arquivos: ok(e.arquivos), comandos: ok(e.comandos) });
  }
  const valido = id => especialidadeExiste(id) || novos.some(x => x.id === id);
  const tarefas = (Array.isArray(j.tarefas) ? j.tarefas : []).slice(0, 8).map((t, k) => ({
    id: k, titulo: curto(semQuebra(t.titulo), 80) || `Tarefa ${k + 1}`, papel: valido(slugDe(t.especialista)) ? slugDe(t.especialista) : '',
    pedido: String(t.pedido || '').slice(0, 5000), depende: (Array.isArray(t.depende) ? t.depende : []).map(Number).filter(n => n >= 0 && n < k), status: 'pendente',
  }));
  if (!tarefas.length) throw new Error('plano vazio');
  p.titulo = p.novo ? p.novo.nome : (curto(semQuebra(j.titulo), 70) || p.titulo);
  p.resumo = censurarTexto(String(j.resumo || '')).slice(0, 600);
  p.stack = (Array.isArray(j.stack) ? j.stack : []).slice(0, 12).map(x => curto(semQuebra(x), 40));
  p.novosEspecialistas = novos;
  p.tarefas = tarefas;
  p.status = 'aguardando';
  const nomeP = id => regrasPapel.find(e => e.id === id)?.nome || novos.find(x => x.id === id)?.nome || 'generalista';
  plano = { texto: `${p.titulo}\n${p.resumo}\n${p.stack.length ? `Stack: ${p.stack.join(', ')}\n` : ''}${novos.length ? `Contratar: ${novos.map(x => x.nome).join(', ')}\n` : ''}\n${tarefas.map((t, k) => `${k + 1}. ${t.titulo} (${nomeP(t.papel)})`).join('\n')}`, agente: 'Gerente', setor: p.setor, em: Date.now() };
  gravarProjetos(); avisar();
  notificar('esperando', `O gerente planejou "${p.titulo}" em ${tarefas.length} tarefas${novos.length ? ` e quer contratar ${novos.length} especialista(s)` : ''}. Abra Projetos para aprovar.`);
}

// ao aprovar: cria a pasta e o setor do projeto novo, contrata os especialistas e registra no cofre
function editarConfig(fn) {
  const arq = path.join(RAIZ, 'config.json');
  const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
  fn(c);
  fs.writeFileSync(arq + '.tmp', JSON.stringify(c, null, 2) + '\n');
  fs.renameSync(arq + '.tmp', arq);
  carregarConfig(); compilarEspecialidades(); reprocessarSetores();
  infoEspecialistas = resumoEspecialistas();
}
function contratarEspecialistas(novos) {
  const criados = [];
  for (const e of novos || []) {
    if (especialidadeExiste(e.id)) continue;
    const ferr = e.ferramentas === 'todas' ? 'todas' : e.ferramentas.join(', ');
    fs.writeFileSync(path.join(DIR_ESPECIALISTAS, `${e.id}.md`),
      `---\nid: ${e.id}\nnome: ${e.nome}\nmodelo: ${e.modelo}\nferramentas: ${ferr}\ndescricao: ${e.descricao}\ncontratado: ${diaDe(Date.now())} pelo gerente\n---\n\n${e.manual}\n`);
    criados.push(e);
  }
  if (criados.length) editarConfig(c => {
    c.especialidades ||= [];
    // os novos entram logo depois de testes/segurança, para a regra deles valer antes das genéricas
    const k = Math.min(2, c.especialidades.length);
    c.especialidades.splice(k, 0, ...criados.map(e => Object.fromEntries(Object.entries({ id: e.id, nome: e.nome, cor: e.cor, instrucao: e.descricao, arquivos: e.arquivos || undefined, comandos: e.comandos || undefined }).filter(([, v]) => v !== undefined))));
  });
  return criados;
}
function criarProjetoNovo(p) {
  const { slug, pasta, nome } = p.novo;
  if (fs.existsSync(pasta)) throw new Error(`a pasta ${pasta} já existe`);
  fs.mkdirSync(pasta, { recursive: false });
  editarConfig(c => {
    const usadas = new Set(c.setores.map(x => x.cor));
    c.setores.push({ id: slug, nome, cor: CORES_SETOR.find(x => !usadas.has(x)) || CORES_SETOR[c.setores.length % CORES_SETOR.length], pastas: [pasta], cofre: [slug] });
  });
  // nota central no cofre, no padrão do índice
  try {
    const arq = path.join(COFRE, '04-projetos', `${slug}.md`), hoje = diaDe(Date.now());
    if (fs.existsSync(COFRE) && !fs.existsSync(arq)) {
      fs.writeFileSync(arq, `---\nname: ${slug}\ndescription: Nota central do projeto ${nome} (criado pelo gerente do escritório em ${hoje})\natualizado: ${hoje}\n---\n\n# ${nome}\n\n- Pasta: \`${pasta}\`\n- Stack: ${(p.stack || []).join(', ') || 'a definir'}\n- Pedido inicial: ${semQuebra(p.pedido).slice(0, 600)}\n\n${p.resumo || ''}\n`);
      const indice = path.join(COFRE, '00-indice-mestre.md'), txt = fs.readFileSync(indice, 'utf8');
      if (!txt.includes(`[[${slug}]]`)) {
        const ls = txt.split('\n'); let k = -1;
        ls.forEach((l, n) => { if (l.startsWith('- 04-projetos/')) k = n; });
        if (k >= 0) { ls.splice(k + 1, 0, `- 04-projetos/[[${slug}]]: ${nome}, projeto criado pelo gerente do escritório (${(p.stack || []).slice(0, 4).join(', ')})`); fs.writeFileSync(indice, ls.join('\n')); }
      }
    }
  } catch (e) { console.error('cofre:', e.message); }
  p.pasta = pasta;
}
function aprovarProjeto(p) {
  if (p.status !== 'aguardando') return { erro: 'Esse projeto não está esperando aprovação.' };
  try {
    if (p.novo) criarProjetoNovo(p);
    p.contratados = contratarEspecialistas(p.novosEspecialistas).map(e => e.id);
  } catch (e) { return { erro: 'Não consegui preparar o projeto: ' + e.message }; }
  p.status = 'executando'; p.aprovado = Date.now();
  avancarProjeto(p);
  return { ok: true };
}
async function avancarProjeto(p) {
  if (p.status !== 'executando') return;
  for (const t of p.tarefas) {
    if (t.status !== 'pendente' || !t.depende.every(d => p.tarefas[d]?.status === 'feito')) continue;
    const antes = t.depende.map(d => p.tarefas[d]).map(x => `- ${x.titulo}: ${x.resumo || 'feito'}`).join('\n');
    const pedido = `Esta tarefa faz parte do projeto "${p.titulo}", coordenado pelo gerente.\nObjetivo geral: ${p.pedido.slice(0, 1500)}\n${antes ? `\nJá foi feito por colegas:\n${antes}\n` : ''}\nSUA TAREFA: ${t.titulo}\n${t.pedido}`;
    const r = await novaOrdem({ setor: p.setor, pedido, conta: p.conta, papel: t.papel }, 'projeto', 'projeto', { tarefa: { projeto: p.id, tarefa: t.id }, pedidoVisivel: `[${p.titulo}] ${t.titulo}` });
    if (r.erro) { t.status = 'erro'; t.erro = r.erro; } else { t.status = 'fazendo'; t.ordem = r.id; }
  }
  if (p.tarefas.every(t => ['feito', 'erro'].includes(t.status))) concluirProjeto(p);
  gravarProjetos(); avisar();
}
function concluirTarefaDeProjeto(rel) {
  const p = projetos.find(x => x.id === rel.projeto.projeto), t = p?.tarefas[rel.projeto.tarefa];
  if (!t || t.status === 'feito') return;
  t.status = 'feito'; t.relatorio = rel.id; t.fim = Date.now();
  t.resumo = rel.simples?.resumo || curto(semQuebra(rel.resposta), 400);
  avancarProjeto(p);
}
function concluirProjeto(p) {
  if (['concluido', 'concluido-com-erros'].includes(p.status)) return;
  const erros = p.tarefas.filter(t => t.status === 'erro');
  p.status = erros.length ? 'concluido-com-erros' : 'concluido';
  p.fim = Date.now();
  const rels = p.tarefas.map(t => relatorios.find(r => r.id === t.relatorio)).filter(Boolean);
  const rel = {
    id: crypto.randomUUID(), sessao: 'projeto-' + p.id, agente: 'Gerente', conta: p.conta, setor: p.setor, cwd: p.pasta,
    pedido: p.pedido.slice(0, 3000),
    resposta: `## Projeto: ${p.titulo}\n\n${p.resumo || ''}\n\n${p.tarefas.map((t, k) => `### ${k + 1}. ${t.titulo} (${regrasPapel.find(e => e.id === t.papel)?.nome || 'generalista'})\n${t.status === 'erro' ? 'Não foi feita: ' + (t.erro || 'erro') : t.resumo || 'Feito.'}`).join('\n\n')}`.slice(0, 8000),
    arquivos: [...new Set(rels.flatMap(r => r.arquivos))].slice(0, 60), comandos: rels.reduce((a, r) => a + r.comandos, 0), ferramentas: rels.reduce((a, r) => a + r.ferramentas, 0),
    tokens: rels.reduce((a, r) => ({ entrada: a.entrada + (r.tokens?.entrada || 0), saida: a.saida + (r.tokens?.saida || 0), cache: a.cache + (r.tokens?.cache || 0) }), { entrada: 0, saida: 0, cache: 0 }),
    custoUSD: rels.reduce((a, r) => a + (r.custoUSD || 0), 0), modo: 'executar', anexos: [], especialidade: 'produto', projetoFinal: p.id,
    inicio: p.criado, fim: Date.now(), lido: false,
  };
  relatorios.unshift(rel);
  p.relatorio = rel.id;
  resumir(rel).catch(() => {}).finally(() => notificar('entrega', `O gerente entregou o projeto "${p.titulo}"${erros.length ? ` (${erros.length} tarefa(s) com erro)` : ''}.`));
  gravarRelatorios(); gravarProjetos(); avisar();
}

// ---------- falas ao vivo: o que o agente escreve entre um passo e outro ----------
async function lerFalas(s) {
  let fh;
  try {
    fh = await fs.promises.open(s.transcript, 'r');
    const { size } = await fh.stat();
    if (size === s.tamFalas) return false;
    s.tamFalas = size;
    const tam = Math.min(size, 400_000), buf = Buffer.alloc(tam);
    await fh.read(buf, 0, tam, size - tam);
    const linhas = buf.toString('utf8').split('\n');
    const falas = [];
    for (let i = linhas.length - 1; i >= 0 && falas.length < 6; i--) {
      let e; try { e = JSON.parse(linhas[i]); } catch { continue; }
      if (e.type === 'user') {
        const c = e.message?.content;
        const real = typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text'));
        if (real) break; // começo do turno atual
        continue;
      }
      if (e.type !== 'assistant') continue;
      const c = e.message?.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
      if (t.trim()) falas.unshift({ t: Date.parse(e.timestamp) || Date.now(), texto: censurarTexto(t.trim()).slice(0, 1200) });
    }
    const antes = JSON.stringify(s.falas || []);
    s.falas = falas;
    return antes !== JSON.stringify(falas);
  } catch { return false; } finally { await fh?.close(); }
}
setInterval(async () => {
  let mudou = false;
  for (const s of sessoes.values()) if (s.estado === 'trabalhando' && s.transcript) mudou = (await lerFalas(s)) || mudou;
  if (mudou) avisar();
}, 3000);

// ---------- corrigir o rumo: interrompe o agente e continua com a nova instrução ----------
async function corrigirRumo(id, pedido) {
  const o = ordens.get(id);
  if (!o || !o.ativa) return { erro: 'Essa tarefa não está rodando agora.' };
  const sessao = [...sessoes.values()].find(x => x.ordem === o.id)?.id || o.sessao;
  if (!sessao) return { erro: 'O agente ainda está começando. Tente de novo em alguns segundos.' };
  pedido = String(pedido || '').trim();
  if (!pedido) return { erro: 'Escreva a correção.' };
  o.interrompidaPara = 'corrigir';
  await rodar('systemctl', ['stop', o.unidade]);
  for (let k = 0; k < 15; k++) {
    const r = await rodar('systemctl', ['is-active', o.unidade]);
    if (!/^(active|activating|deactivating)/.test((r.saida + r.stderr).trim())) break;
    await new Promise(ok => setTimeout(ok, 1000));
  }
  o.ativa = false; o.fim = Date.now();
  const sx = sessoes.get(sessao);
  if (sx) { mudarEstado(sx, 'ocioso'); sx.tarefa = null; }
  return novaOrdem({ sessao, pedido: `A dona interrompeu o seu trabalho para corrigir o rumo:\n${pedido}\n\nContinue a partir do que você já fez, levando isso em conta.`, modo: 'executar' }, 'corrigir', 'corrigir',
    { tarefa: o.tarefa, pedidoVisivel: pedido });
}

// ---------- POs por produto ----------
const NOMES_PO = ['Lia', 'Davi', 'Teresa', 'Marcos', 'Clara', 'Rui', 'Helena', 'Pedro', 'Sofia', 'Caio', 'Luísa', 'Tomás'];
const temPO = setorId => !!config.setores.find(x => x.id === setorId)?.po;
const nomePO = setorId => NOMES_PO[[...String(setorId)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NOMES_PO.length];
const arquivoBacklog = setorId => { const pre = prefixosCofre(setorId)[0] || setorId; return path.join(COFRE, '04-projetos', `${pre}-backlog.md`); };
function garantirNoIndice(nota, descricao) {
  try {
    const indice = path.join(COFRE, '00-indice-mestre.md'), txt = fs.readFileSync(indice, 'utf8');
    if (txt.includes(`[[${nota}]]`)) return;
    const ls = txt.split('\n'); let k = -1;
    ls.forEach((l, n) => { if (l.startsWith('- 04-projetos/')) k = n; });
    if (k >= 0) { ls.splice(k + 1, 0, `- 04-projetos/[[${nota}]]: ${descricao}`); fs.writeFileSync(indice, ls.join('\n')); }
  } catch (e) { console.error('índice do cofre:', e.message); }
}
function defPO(setorId) {
  const esp = lerEspecialista('po');
  return { description: `PO de ${nomeSetor(setorId)}`, prompt: `${contextoEmpresa()}\n\n---\n\n${esp?.manual || ''}\n\nVocê é o PO do produto **${nomeSetor(setorId)}**. Seu arquivo de backlog: ${arquivoBacklog(setorId)}.`,
    model: esp?.modelo || 'sonnet', tools: esp?.ferramentas || ['Read', 'Grep', 'Glob', 'Edit', 'Write'] };
}
async function refinarComPO(p) {
  const prompt = `A dona pediu um projeto para ${nomeSetor(p.setor)}: «${p.pedido.slice(0, 3000)}».
Leia o backlog (${arquivoBacklog(p.setor)}, se existir) e as notas do produto no cofre que forem relevantes: ${notasDoProjeto(p.setor).join(', ')}.
Refine o pedido. Não edite nada agora. Responda APENAS JSON: {"historias": [{"titulo": "curto", "historia": "Como … quero … para …", "criterios": ["critério testável", "..."]}], "prioridade": "alta|media|baixa", "foraDoEscopo": ["..."]}`;
  const r = await rodarClaudeLeitura(p.pasta, p.conta, prompt, { po: { ...defPO(p.setor), tools: ['Read', 'Grep', 'Glob'] } }, 'po', 10 * 60_000, [COFRE]);
  const j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
  return { historias: (j.historias || []).slice(0, 8), prioridade: j.prioridade || '', foraDoEscopo: (j.foraDoEscopo || []).slice(0, 6) };
}

// relatório de rotina: vira uma conversa própria na papelada e vai para a sua mesa
function entregarRotina({ sessao, agente, setor, especialidade, pedido, simples, resposta, cwd, conta }) {
  const rel = { id: crypto.randomUUID(), sessao, agente, conta, setor, cwd, pedido, resposta: censurarTexto(resposta).slice(0, 8000), simples,
    arquivos: [], comandos: 0, ferramentas: 0, tokens: { entrada: 0, saida: 0, cache: 0 }, modo: 'executar', anexos: [], especialidade, rotina: true,
    avaliacao: { tipo: 'aprovado', em: Date.now() }, inicio: Date.now(), fim: Date.now(), lido: false };
  relatorios.unshift(rel);
  relatorios.length = Math.min(relatorios.length, MAX_RELATORIOS);
  gravarRelatorios(); avisar();
  return rel;
}

const ARQ_ROTINAS = path.join(DADOS, 'rotinas.json');
let estadoRotinas = { devops: {}, po: {} };
try { estadoRotinas = { ...estadoRotinas, ...JSON.parse(fs.readFileSync(ARQ_ROTINAS, 'utf8')) }; } catch { /* primeira vez */ }
const gravarRotinas = () => gravarJSON(ARQ_ROTINAS, estadoRotinas);

// a ronda coleta os dados sozinha (só leitura) e o modelo só analisa
async function coletarSaude() {
  const cmd = async (c, a) => { const r = await rodar(c, a, null, 20_000); return (r.saida + r.stderr).trim().slice(0, 6000); };
  const dados = {
    carga: await cmd('cat', ['/proc/loadavg']), cpus: await cmd('nproc', []),
    memoria: await cmd('free', ['-m']), disco: await cmd('df', ['-h', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'overlay', '-x', 'squashfs']),
    containers: await cmd('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}']),
    servicosComFalha: await cmd('systemctl', ['--failed', '--no-legend', '--plain']),
    errosUltimas24h: await cmd('journalctl', ['-p', 'err', '--since', '-24h', '--no-pager', '-n', '60', '-o', 'short-iso']),
    backups: (config.pastasBackup || []).length ? await cmd('find', [...config.pastasBackup, '-maxdepth', '3', '-type', 'f', '-mtime', '-8', '-printf', '%TY-%Tm-%Td %TH:%TM %s %p\n']) : '(nenhuma pasta de backup configurada)',
    tailscale: await cmd('tailscale', ['status', '--peers=false']),
  };
  // certificados: domínios das regras do Traefik nos containers, validade conferida conectando em cada um
  try {
    const labels = await cmd('docker', ['ps', '--format', '{{.Labels}}']);
    const dominios = [...new Set([...labels.matchAll(/Host\(`([^`]+)`\)/g)].map(m => m[1]).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))].slice(0, 20);
    const validade = d => new Promise(ok => {
      const sock = tls.connect({ host: d, port: 443, servername: d, timeout: 8000, rejectUnauthorized: false }, () => {
        const c = sock.getPeerCertificate(); sock.end();
        ok(c?.valid_to ? `${d}: vence em ${new Date(c.valid_to).toISOString().slice(0, 10)}${sock.authorized ? '' : ' (certificado não confiável)'}` : `${d}: sem certificado`);
      });
      sock.on('error', e => ok(`${d}: erro ao conectar (${e.code || e.message})`));
      sock.on('timeout', () => { sock.destroy(); ok(`${d}: sem resposta`); });
    });
    dados.certificados = dominios.length ? (await Promise.all(dominios.map(validade))).join('\n') : 'nenhum domínio encontrado nas regras do Traefik';
  } catch (e) { dados.certificados = 'não consegui conferir os certificados: ' + e.message; }
  return dados;
}
async function rondaDevops(origem = 'agenda') {
  if (estadoRotinas.devops.rodando) return { erro: 'A ronda já está rodando.' };
  const cfg = config.rotinas?.devops || {};
  estadoRotinas.devops = { ...estadoRotinas.devops, rodando: true, inicio: Date.now() }; avisar();
  try {
    const dados = await coletarSaude();
    const hoje = diaDe(Date.now());
    const prompt = `Você é o DevOps líder da ${EMPRESA()} fazendo a ronda diária da VPS de produção (${hoje}). Os dados abaixo foram coletados agora, só leitura. Analise e responda APENAS JSON:
{"status": "ok|atencao|critico", "titulo": "frase curta", "resumo": "2 a 3 frases em português simples para a dona (não técnica)",
 "itens": [{"area": "Containers|Disco|Memória|Serviços|Erros|Backups|Certificados|Tailscale|Carga", "status": "ok|atencao|critico", "detalhe": "1 frase"}],
 "recomendacoes": ["ação sugerida, sem executar", "..."]}
Critérios: disco >80% atenção, >90% crítico; memória disponível <10% atenção; container parado ou reiniciando que deveria estar no ar = atenção (crítico se for de produção, como ${servidoresDeProducao() || 'os sistemas de produção'}); backup mais novo com mais de 2 dias = atenção; certificado vencendo em <14 dias = atenção, <3 dias crítico; serviço systemd com falha = atenção.
Contexto desta VPS (não confunda com problema): o "escritório dos agentes" cria unidades temporárias do systemd (escritorio-ordem-*, run-*.service/scope) várias vezes ao dia para rodar agentes; muitas sessões/unidades em pouco tempo é ATIVIDADE NORMAL dele, não invasão. Avisos "Failed to add ... inotify watch ... No space left on device" significam que o limite do Linux para monitorar arquivos (fs.inotify.max_user_watches / max_user_instances) está esgotado: é um ajuste de configuração, não ataque; se aparecerem, recomende aumentar esse limite.
Não exponha segredos.

DADOS:
${Object.entries(dados).map(([k, v]) => `## ${k}\n${v}`).join('\n\n')}`;
    const def = { description: 'DevOps líder', prompt: contextoEmpresa(), model: cfg.modelo || 'sonnet', tools: ['Read'] };
    const r = await rodarClaudeLeitura('/tmp', cfg.conta || 'empresa', prompt, { devops: def }, 'devops', 10 * 60_000);
    const j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
    const st = ['ok', 'atencao', 'critico'].includes(j.status) ? j.status : 'atencao';
    const itens = (Array.isArray(j.itens) ? j.itens : []).slice(0, 12);
    const marca = x => ({ ok: '✓', atencao: '!', critico: '✕' }[x] || '·');
    const resposta = `## Ronda da produção · ${hoje}\n\n${j.resumo || ''}\n\n| Área | Situação | Detalhe |\n|---|---|---|\n${itens.map(i => `| ${i.area} | ${marca(i.status)} ${i.status} | ${String(i.detalhe || '').replace(/\|/g, '/')} |`).join('\n')}\n\n${(j.recomendacoes || []).length ? '### Recomendações\n' + j.recomendacoes.map(x => '- ' + x).join('\n') : ''}`;
    const fixo = (config.especialidades || []).findIndex(e => e.id === 'devops');
    entregarRotina({ sessao: 'rotina-devops', agente: 'DevOps', setor: 'escritorio', especialidade: 'devops', cwd: '/root', conta: cfg.conta || 'empresa',
      pedido: `Ronda diária da produção (${origem === 'agenda' ? 'automática' : 'pedida por você'})`, resposta,
      simples: { titulo: censurarTexto(j.titulo || 'Ronda da produção'), resumo: censurarTexto(j.resumo || ''), feito: itens.filter(i => i.status !== 'ok').map(i => `${i.area}: ${censurarTexto(i.detalhe)}`).slice(0, 6),
        resultado: { status: st === 'critico' ? 'problema' : st, texto: st === 'ok' ? 'Produção toda no verde.' : st === 'atencao' ? 'Tem ponto de atenção, nada parado.' : 'Tem problema que precisa de ação.' },
        proximos: (j.recomendacoes || []).slice(0, 4).map(x => censurarTexto(String(x))), termos: [], pergunta: '', bloqueio: '' } });
    estadoRotinas.devops = { ultima: Date.now(), status: st, rodando: false, fixo };
    if (st !== 'ok') notificar('falha', `Ronda da produção: ${st === 'critico' ? 'PROBLEMA' : 'atenção'}. ${j.resumo || ''}`);
  } catch (e) {
    console.error('ronda devops:', e.message);
    estadoRotinas.devops = { ...estadoRotinas.devops, rodando: false, erro: e.message, ultima: Date.now() };
  }
  gravarRotinas(); avisar();
  return { ok: true };
}
async function resumoSemanalPO(setorId, origem = 'agenda') {
  if (!temPO(setorId)) return { erro: 'Esse produto não tem PO.' };
  const pasta = pastaDoSetor(setorId);
  if (!pasta) return { erro: 'Setor sem pasta.' };
  if ((estadoRotinas.po[setorId] || {}).rodando) return { erro: 'O resumo desse PO já está rodando.' };
  const cfg = config.rotinas?.poSemanal || {};
  estadoRotinas.po[setorId] = { ...(estadoRotinas.po[setorId] || {}), rodando: true }; avisar();
  try {
    const desde = Date.now() - 7 * 864e5;
    const pastas = (config.setores.find(x => x.id === setorId)?.pastas || []).filter(x => fs.existsSync(path.join(x, '.git')) || fs.existsSync(x));
    let commits = '';
    for (const pa of pastas) {
      const r = await rodar('git', ['-C', pa, 'log', '--since=7.days.ago', '--pretty=format:%ad %s', '--date=short', '-n', '40'], null, 20_000);
      if (r.saida.trim()) commits += `### ${pa}\n${r.saida.trim()}\n`;
    }
    const entregas = relatorios.filter(r => r.setor === setorId && r.fim > desde && !r.rotina).slice(0, 30)
      .map(r => `- ${diaDe(r.fim)} ${r.agente}: ${r.simples?.titulo || curto(semQuebra(r.pedido), 80)}${r.avaliacao?.tipo === 'refazer' ? ' (a dona pediu para refazer)' : ''}`).join('\n');
    const backlog = arquivoBacklog(setorId), nota = path.basename(backlog, '.md');
    const prompt = `Faça o resumo semanal do produto ${nomeSetor(setorId)} e atualize o backlog.
1) Leia o backlog (${backlog}); se não existir, CRIE com frontmatter (name: ${nota}, description: Backlog do produto ${nomeSetor(setorId)} mantido pelo PO do escritório, atualizado: ${diaDe(Date.now())}) e as seções: Visão, Agora, Próximo, Depois, Feito recentemente, Decisões da dona.
2) Leia as notas do produto que ajudarem: ${notasDoProjeto(setorId).join(', ')}.
3) Atualize o backlog com o que aconteceu na semana (mova itens para "Feito recentemente" com data, ajuste prioridades). Só edite esse arquivo.
4) Responda APENAS JSON: {"titulo": "curto", "resumo": "3 frases simples", "andou": ["..."], "travou": ["..."], "sugestoes": ["próximo passo sugerido", "..."], "status": "ok|atencao|problema"}

Commits da semana:
${commits || '(nenhum commit nos últimos 7 dias)'}

Entregas do escritório na semana:
${entregas || '(nenhuma)'}`;
    const r = await rodarClaudeLeitura(pasta, cfg.conta || 'empresa', prompt, { po: defPO(setorId) }, 'po', 15 * 60_000, [COFRE]);
    const j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
    if (fs.existsSync(backlog)) garantirNoIndice(nota, `backlog do ${nomeSetor(setorId)} mantido pelo PO do escritório (Agora, Próximo, Depois, Feito, Decisões)`);
    const lista = (t, xs) => (xs || []).length ? `### ${t}\n${xs.map(x => '- ' + x).join('\n')}\n` : '';
    entregarRotina({ sessao: 'po-' + setorId, agente: `${nomePO(setorId)} (PO)`, setor: setorId, especialidade: 'po', cwd: pasta, conta: cfg.conta || 'empresa',
      pedido: `Resumo semanal do ${nomeSetor(setorId)} (${origem === 'agenda' ? 'automático' : 'pedido por você'})`,
      resposta: `## Semana do ${nomeSetor(setorId)}\n\n${j.resumo || ''}\n\n${lista('O que andou', j.andou)}${lista('O que travou', j.travou)}${lista('Sugestões do PO', j.sugestoes)}\nBacklog atualizado em \`${backlog}\`.`,
      simples: { titulo: censurarTexto(j.titulo || `Semana do ${nomeSetor(setorId)}`), resumo: censurarTexto(j.resumo || ''), feito: (j.andou || []).slice(0, 6).map(x => censurarTexto(String(x))),
        resultado: { status: ['ok', 'atencao', 'problema'].includes(j.status) ? j.status : 'ok', texto: (j.travou || []).length ? `Travou: ${censurarTexto(String(j.travou[0]))}` : 'Nada travado.' },
        proximos: (j.sugestoes || []).slice(0, 4).map(x => censurarTexto(String(x))), termos: [], pergunta: '', bloqueio: '' } });
    estadoRotinas.po[setorId] = { ultima: Date.now(), rodando: false };
    notificar('entrega', `${nomePO(setorId)}, PO do ${nomeSetor(setorId)}, mandou o resumo da semana: ${j.resumo || ''}`);
  } catch (e) {
    console.error('po semanal:', e.message);
    estadoRotinas.po[setorId] = { ...(estadoRotinas.po[setorId] || {}), rodando: false, erro: e.message, ultima: Date.now() };
  }
  gravarRotinas(); avisar();
  return { ok: true };
}
setInterval(async () => {
  const { data, hora, dia } = agoraNoFuso(), rot = config.rotinas || {};
  const d = rot.devops;
  if (d?.ativo && d.hora === hora && estadoRotinas.devops.marca !== data) {
    estadoRotinas.devops.marca = data;
    rondaDevops('agenda');
  }
  const ps = rot.poSemanal;
  if (ps?.ativo && ps.dia === dia && ps.hora === hora && estadoRotinas.poMarca !== data) {
    estadoRotinas.poMarca = data;
    for (const s of config.setores.filter(x => x.po)) await resumoSemanalPO(s.id, 'agenda');
  }
}, 20_000);

// ---------- datacenter: projetos que rodam no Docker (só leitura) ----------
let servidores = [], servidoresEm = 0;
function grupoDoContainer(nome, projetoCompose, projetoCoolify) {
  for (const g of config.servidores || []) {
    if (projetoCoolify && (g.projeto || []).includes(projetoCoolify)) return g;
    if (projetoCompose && (g.projeto || []).includes(projetoCompose)) return g;
    try { if (g.regra && new RegExp(g.regra, 'i').test(nome)) return g; } catch { /* regra inválida */ }
  }
  return { nome: 'Outros' };
}
async function coletarServidores() {
  const ps = await rodar('docker', ['ps', '-a', '--format', '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}|{{.Label "com.docker.compose.project"}}|{{.Label "coolify.projectName"}}|{{.Label "coolify.resourceName"}}'], null, 20_000);
  if (ps.erro) return;
  const st = await rodar('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}'], null, 30_000);
  const uso = Object.fromEntries(st.saida.split('\n').filter(Boolean).map(l => { const [n, cpu, mem, memp] = l.split('|'); return [n, { cpu, mem, memp }]; }));
  const grupos = new Map();
  for (const l of ps.saida.split('\n').filter(Boolean)) {
    const [nome, estado, status, imagem, compose, coolify, recurso] = l.split('|');
    const g = grupoDoContainer(nome, compose, coolify);
    if ((config.servidoresIgnorar || []).some(r => { try { return new RegExp(r, 'i').test(nome); } catch { return false; } })) continue;
    if (!grupos.has(g.nome)) grupos.set(g.nome, { nome: g.nome, setor: g.setor || null, tipo: g.tipo || 'producao', nota: g.nota || '', containers: [] });
    const saude = estado !== 'running' ? 'parado' : /unhealthy/.test(status) ? 'atencao' : /starting|restarting/.test(status) ? 'atencao' : 'ok';
    const ambiente = g.tipo === 'dev' ? 'desenvolvimento' : g.tipo === 'interno' ? 'interno' : /produc|prod\b|-prod/.test(recurso || nome) ? 'produção' : /homolog|staging/.test(recurso || nome) ? 'homologação' : '';
    grupos.get(g.nome).containers.push({ nome: recurso || nome, container: nome, estado, status, saude, ambiente, imagem: String(imagem).split('@')[0].slice(0, 60), ...(uso[nome] || {}) });
  }
  // checagens HTTP de sistemas que rodam fora do Docker (ex.: um site rodando direto no servidor)
  for (const g of config.servidores || []) for (const ch of g.checagens || []) {
    if (!grupos.has(g.nome)) grupos.set(g.nome, { nome: g.nome, setor: g.setor || null, tipo: g.tipo || 'producao', nota: g.nota || '', containers: [] });
    const t0 = Date.now();
    let codigo = 0;
    try { codigo = (await fetch(ch.url, { signal: AbortSignal.timeout(8000), redirect: 'manual' })).status; } catch { codigo = 0; }
    const ms = Date.now() - t0, ok = codigo >= 200 && codigo < 400;
    grupos.get(g.nome).containers.push({ nome: ch.nome, container: 'http:' + ch.url, estado: ok ? 'running' : 'exited', status: ok ? `respondendo (HTTP ${codigo}, ${ms} ms)` : codigo ? `respondeu HTTP ${codigo}` : 'não respondeu',
      saude: ok ? (ms > 5000 ? 'atencao' : 'ok') : 'parado', ambiente: g.tipo === 'producao' ? 'produção' : '', imagem: ch.url });
  }
  const ordem = (config.servidores || []).map(x => x.nome);
  servidores = [...grupos.values()].sort((a, b) => (ordem.indexOf(a.nome) + 1 || 99) - (ordem.indexOf(b.nome) + 1 || 99));
  const relevante = c => !['homologação', 'desenvolvimento', 'interno'].includes(c.ambiente);
  for (const g of servidores) g.saude = g.containers.some(c => c.saude === 'parado' && relevante(c)) ? 'parado' : g.containers.some(c => c.saude !== 'ok' && relevante(c)) ? 'atencao' : 'ok';
  servidoresEm = Date.now();
  avisar();
}
setTimeout(coletarServidores, 4000);
setInterval(rotina('datacenter', coletarServidores), 30_000);

// ---------- saúde das rotinas do próprio escritório ----------
const saudeRotinas = {};
function rotina(nome, fn) {
  return async (...args) => {
    const r = (saudeRotinas[nome] ||= { execucoes: 0, erros: 0 }), t0 = Date.now();
    r.rodando = true; r.inicio = t0;
    try { const v = await fn(...args); r.ok = Date.now(); r.erro = ''; return v; }
    catch (e) { r.erros++; r.erro = String(e?.message || e).slice(0, 300); r.falhou = Date.now(); console.error(nome + ':', r.erro); }
    finally { r.rodando = false; r.execucoes++; r.ms = Date.now() - t0; r.ultima = Date.now(); }
  };
}
process.on('unhandledRejection', e => console.error('promessa sem tratamento:', e?.message || e));

// ---------- métricas do servidor (memória, disco, carga) guardadas por 7 dias ----------
const ARQ_METRICAS = path.join(DADOS, 'metricas.json');
let metricas = [];
try { metricas = JSON.parse(fs.readFileSync(ARQ_METRICAS, 'utf8')); } catch { metricas = []; }
async function medirServidor() {
  const mem = fs.readFileSync('/proc/meminfo', 'utf8'), v = k => Number((mem.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0);
  const df = await rodar('df', ['-P', '/'], null, 10_000), cols = (df.saida.split('\n')[1] || '').split(/\s+/);
  const carga = Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
  metricas.push({ t: Date.now(), mem: Math.round((1 - v('MemAvailable') / v('MemTotal')) * 1000) / 10, swap: v('SwapTotal') ? Math.round((1 - v('SwapFree') / v('SwapTotal')) * 1000) / 10 : 0,
    disco: Number(String(cols[4] || '').replace('%', '')) || 0, carga: Math.round(carga * 100) / 100, nucleos: os.cpus().length,
    agentes: [...sessoes.values()].filter(x => x.estado === 'trabalhando').length });
  const corte = Date.now() - 7 * 864e5;
  while (metricas.length && metricas[0].t < corte) metricas.shift();
  gravarJSON(ARQ_METRICAS, metricas);
}
const medirServidorR = rotina('metricas', medirServidor);
setInterval(medirServidorR, 15 * 60_000);
setTimeout(medirServidorR, 20_000);

// ---------- vigia de infraestrutura: confere de tempo em tempo e abre incidentes ----------
const ARQ_INCIDENTES = path.join(DADOS, 'incidentes.json');
let incidentes = [];
try { incidentes = JSON.parse(fs.readFileSync(ARQ_INCIDENTES, 'utf8')); } catch { incidentes = []; }
const gravarIncidentes = () => gravarJSON(ARQ_INCIDENTES, incidentes.slice(0, 200));
async function problemasAgora() {
  const cfg = config.rotinas?.vigia || {}, lista = [];
  for (const g of servidores) for (const c of g.containers) {
    if (['homologação', 'desenvolvimento', 'interno'].includes(c.ambiente) || /buildkit/.test(c.container)) continue;
    if (c.saude === 'parado') lista.push({ chave: 'ct:' + c.container, titulo: `${g.nome}: ${c.nome} está parado`, servidor: g.nome, setor: g.setor, container: c.container });
    else if (c.saude === 'atencao') lista.push({ chave: 'ct:' + c.container, titulo: `${g.nome}: ${c.nome} com problema de saúde`, servidor: g.nome, setor: g.setor, container: c.container });
  }
  lista.push(...whatsapp.problemas);
  const df = await rodar('df', ['-P', '/'], null, 10_000);
  const uso = Number((df.saida.split('\n')[1] || '').split(/\s+/)[4]?.replace('%', ''));
  if (uso >= (cfg.discoAlerta || 85)) lista.push({ chave: 'disco', titulo: `Disco do servidor com ${uso}% de uso` });
  try {
    const mem = fs.readFileSync('/proc/meminfo', 'utf8');
    const v = k => Number((mem.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0);
    const disp = v('MemAvailable') / v('MemTotal') * 100;
    if (disp < (cfg.memoriaMinima || 8)) lista.push({ chave: 'memoria', titulo: `Memória quase esgotada (${disp.toFixed(0)}% disponível)` });
  } catch { /* sem /proc */ }
  return lista;
}
async function diagnosticar(inc) {
  const cfg = config.rotinas?.devops || {};
  let dados = '';
  if (inc.container) {
    const st = await rodar('docker', ['inspect', '--format', 'estado={{.State.Status}} saude={{if .State.Health}}{{.State.Health.Status}}{{end}} codigo={{.State.ExitCode}} reinicios={{.RestartCount}} erro={{.State.Error}} iniciado={{.State.StartedAt}} terminado={{.State.FinishedAt}}', inc.container], null, 15_000);
    const lg = await rodar('docker', ['logs', '--tail', '80', '--timestamps', inc.container], null, 20_000);
    dados = `## estado\n${st.saida || st.stderr}\n\n## últimas linhas do log\n${censurarTexto((lg.saida + lg.stderr).slice(-9000))}`;
  } else {
    const d = await rodar('df', ['-h'], null, 10_000), m = await rodar('free', ['-m'], null, 10_000);
    const top = await rodar('ps', ['-eo', 'pid,comm,%mem,%cpu', '--sort=-%mem'], null, 10_000);
    dados = `## disco\n${d.saida}\n## memória\n${m.saida}\n## processos que mais usam memória\n${top.saida.split('\n').slice(0, 15).join('\n')}`;
  }
  const prompt = `Você é o DevOps líder da ${EMPRESA()}. O vigia do escritório abriu um incidente agora: "${inc.titulo}".
Analise os dados (coletados só leitura) e responda APENAS JSON: {"titulo": "frase curta", "resumo": "2 a 3 frases simples para a dona", "causa": "causa provável", "gravidade": "atencao|critico", "recomendacoes": ["ação sugerida, sem executar", "..."]}
Não exponha segredos. Contexto: unidades systemd-run do escritório e avisos de inotify não são invasão.

${dados}`;
  const r = await rodarClaudeLeitura('/tmp', cfg.conta || 'empresa', prompt, { devops: { description: 'DevOps líder', prompt: contextoEmpresa(), model: 'sonnet', tools: ['Read'] } }, 'devops', 5 * 60_000);
  const j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
  inc.diagnostico = { resumo: censurarTexto(String(j.resumo || '')), causa: censurarTexto(String(j.causa || '')), gravidade: j.gravidade === 'critico' ? 'critico' : 'atencao' };
  entregarRotina({ sessao: 'incidentes-devops', agente: 'DevOps', setor: inc.setor || 'escritorio', especialidade: 'devops', cwd: '/root', conta: cfg.conta || 'empresa',
    pedido: `Incidente aberto pelo vigia: ${inc.titulo}`,
    resposta: `## Incidente: ${inc.titulo}\n\n${j.resumo || ''}\n\n**Causa provável:** ${j.causa || 'não identificada'}\n\n${(j.recomendacoes || []).length ? '### O que sugiro\n' + j.recomendacoes.map(x => '- ' + x).join('\n') : ''}`,
    simples: { titulo: censurarTexto(j.titulo || inc.titulo), resumo: censurarTexto(j.resumo || ''), feito: [`Causa provável: ${censurarTexto(String(j.causa || 'não identificada'))}`],
      resultado: { status: j.gravidade === 'critico' ? 'problema' : 'atencao', texto: j.gravidade === 'critico' ? 'Precisa de ação.' : 'Vale olhar.' },
      proximos: (j.recomendacoes || []).slice(0, 4).map(x => censurarTexto(String(x))), termos: [], pergunta: '', bloqueio: '' } });
}
// ---------- vigia do WhatsApp: número que parece conectado mas parou de receber (travado), ou caiu ----------
// Só leitura: consulta o banco do Evolution. Não reinicia nada; a dona decide.
let whatsapp = { problemas: [], numeros: [], conferidoEm: 0 };
const DIAS_SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtComercial = () => new Intl.DateTimeFormat('en-US', { timeZone: FUSO(), weekday: 'short', hour: 'numeric', hour12: false });
// minutos de horário comercial entre dois instantes (passos de 5 min, no máximo 7 dias)
function minutosComerciais(desde, ate, cfg) {
  const f = fmtComercial(), dias = cfg.dias || [1, 2, 3, 4, 5, 6], ini = cfg.inicio ?? 8, fim = cfg.fim ?? 20;
  let min = 0;
  for (let t = Math.max(desde, ate - 7 * 864e5); t < ate; t += 5 * 60_000) {
    const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]));
    const h = Number(p.hour) % 24;
    if (dias.includes(DIAS_SEMANA.indexOf(p.weekday)) && h >= ini && h < fim) min += 5;
  }
  return min;
}
const horaCurta = t => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t).replace(',', ' às');
async function conferirWhatsapp() {
  const cfg = config.rotinas?.whatsapp || {};
  if (!cfg.ativo) { whatsapp.problemas = []; return; }
  const sql = `select i.name, coalesce(i."profileName", ''), i."connectionStatus", split_part(coalesce(i."ownerJid", ''), '@', 1),
    coalesce(max(m."messageTimestamp"), 0), count(m.*) filter (where m.key->>'fromMe' = 'false' and m."messageTimestamp" > extract(epoch from now() - interval '7 days'))
    from evolution_api."Instance" i left join evolution_api."Message" m on m."instanceId" = i.id group by 1, 2, 3, 4`;
  const problemas = [], numeros = [], agora = Date.now(), limite = (cfg.horasSemMensagem || 2) * 60, minimo = cfg.minimoMensagens7d ?? 10;
  for (const b of cfg.bancos || []) {
    const r = await rodar('docker', ['exec', b.container, 'sh', '-c', `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F '\t' -c '${sql.replace(/'/g, "'\\''")}'`], null, 60_000);
    if (r.erro) { console.error('whatsapp:', b.container, (r.stderr || '').slice(0, 200)); continue; }
    const linhas = r.saida.split('\n').filter(Boolean).map(l => l.split('\t'));
    // números com uma conexão ativa: conexões antigas do mesmo número (substituídas) não contam
    const ativos = new Set(linhas.filter(x => x[2] === 'open' && x[3]).map(x => x[3]));
    for (const [nome, perfil, estado, dono, ts, msgs7d] of linhas) {
      if (estado !== 'open' && dono && ativos.has(dono)) continue;
      const final = dono.slice(-4);
      const loja = perfil || (final ? `número final ${final}` : nome), ultima = Number(ts) * 1000, n7 = Number(msgs7d);
      const parado = ultima ? minutosComerciais(ultima, agora, cfg) : 0;
      numeros.push({ sistema: b.sistema, loja, estado, ultima, mensagens7d: n7, minutosParado: parado });
      if (n7 < minimo) continue; // número sem movimento normal: silêncio não quer dizer nada
      const base = { servidor: b.sistema, setor: b.setor, semDiagnostico: true };
      if (estado === 'open' && parado >= limite)
        problemas.push({ ...base, chave: 'wa:' + nome, titulo: `WhatsApp da ${loja} (${b.sistema}) parou de receber mensagens desde ${horaCurta(ultima)}`,
          aviso: `O número aparece como conectado, mas não chega mensagem há ${Math.round(parado / 60)}h de horário comercial. Provável travamento: reinicie a conexão desse número no Evolution (normalmente volta sem QR). As mensagens desde ${horaCurta(ultima)} estão no celular, mas a IA não respondeu.` });
      else if (estado !== 'open')
        problemas.push({ ...base, chave: 'wa:' + nome, titulo: `WhatsApp da ${loja} (${b.sistema}) está desconectado`,
          aviso: `O número saiu do ar (estado: ${estado}). Pode ser preciso ler o QR de novo no painel (WhatsApp › Conexão).` });
    }
  }
  whatsapp = { problemas, numeros, conferidoEm: agora };
  avisar();
}
const conferirWhatsappR = rotina('whatsapp', conferirWhatsapp);
setInterval(conferirWhatsappR, 60_000 * Math.max(5, config.rotinas?.whatsapp?.minutos || 60));
setTimeout(conferirWhatsappR, 30_000);

let vigiaRodando = false;
async function vigiar() {
  const cfg = config.rotinas?.vigia || {};
  if (!cfg.ativo || vigiaRodando || !servidoresEm) return;
  vigiaRodando = true;
  try {
    const agora = await problemasAgora(), chaves = new Set(agora.map(x => x.chave));
    for (const pr of agora) {
      let inc = incidentes.find(x => x.chave === pr.chave && x.status === 'aberto');
      if (inc) continue;
      inc = { id: crypto.randomBytes(5).toString('hex'), ...pr, status: 'aberto', desde: Date.now() };
      incidentes.unshift(inc);
      notificar('falha', pr.aviso ? `Incidente: ${pr.titulo}. ${pr.aviso}` : `Incidente: ${pr.titulo}. O DevOps está investigando.`);
      if (pr.semDiagnostico) continue;
      const ultimoDiag = incidentes.find(x => x.chave === pr.chave && x !== inc && x.diagnosticadoEm)?.diagnosticadoEm || 0;
      if (cfg.diagnosticar !== false && Date.now() - ultimoDiag > 6 * 3600_000) {
        inc.investigando = true; inc.diagnosticadoEm = Date.now(); avisar();
        diagnosticar(inc).catch(e => console.error('diagnóstico:', e.message)).finally(() => { inc.investigando = false; gravarIncidentes(); avisar(); });
      }
    }
    for (const inc of incidentes.filter(x => x.status === 'aberto' && !chaves.has(x.chave))) {
      inc.status = 'resolvido'; inc.resolvido = Date.now();
      notificar('falha', `Resolvido: ${inc.titulo} (durou ${Math.round((inc.resolvido - inc.desde) / 60_000)} min).`);
    }
    gravarIncidentes(); avisar();
  } catch (e) { console.error('vigia:', e.message); } finally { vigiaRodando = false; }
}
const vigiarR = rotina('vigia', vigiar);
setInterval(vigiarR, 60_000 * Math.max(1, config.rotinas?.vigia?.minutos || 5));
setTimeout(vigiarR, 45_000);

// ---------- estrategista: dados da empresa para ele pensar ----------
function panoramaDaEmpresa() {
  const desde = Date.now() - 30 * 864e5, porSetor = {};
  for (const r of relatorios) if (r.fim > desde && !r.rotina) { const p = (porSetor[nomeSetor(r.setor)] ||= { entregas: 0, refazer: 0 }); p.entregas++; if (r.avaliacao?.tipo === 'refazer') p.refazer++; }
  const c = consumo();
  const backlogs = config.setores.filter(x => x.po).map(x => `${x.nome}: ${arquivoBacklog(x.id)}`);
  return `Dados do escritório (últimos 30 dias):
- Entregas por produto: ${Object.entries(porSetor).map(([k, v]) => `${k} ${v.entregas}${v.refazer ? ` (${v.refazer} refeitas)` : ''}`).join('; ') || 'nenhuma'}
- Tokens no mês por produto: ${Object.entries(c.porSetor).map(([k, v]) => `${nomeSetor(k)} ${Math.round(v.tokens / 1000)} mil`).join('; ') || 'nada'}
- Projetos: ${projetos.slice(0, 10).map(p => `${p.titulo} (${p.status})`).join('; ') || 'nenhum'}
- Incidentes abertos: ${incidentes.filter(i => i.status === 'aberto').map(i => i.titulo).join('; ') || 'nenhum'}
- Backlogs dos POs: ${backlogs.join('; ') || 'ainda não há'}
- Servidores no Docker: ${servidores.map(g => `${g.nome} (${g.containers.length} containers, ${g.saude})`).join('; ')}`;
}
async function memorandoEstrategico(origem = 'agenda') {
  if (estadoRotinas.estrategia?.rodando) return { erro: 'O memorando já está sendo escrito.' };
  const cfg = config.rotinas?.estrategiaMensal || {};
  estadoRotinas.estrategia = { ...(estadoRotinas.estrategia || {}), rodando: true }; avisar();
  try {
    const esp = lerEspecialista('estrategia');
    const prompt = `Escreva o MEMORANDO ESTRATÉGICO do mês para a dona da ${EMPRESA()}.
${panoramaDaEmpresa()}

Leia os backlogs e as notas do cofre que ajudarem (04-projetos, 02-decisoes, e o seu arquivo ${config.notaEstrategia || String(EMPRESA()).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-') + '-estrategia'}.md se existir). Atualize o seu arquivo de estratégia com o essencial deste mês.
Responda APENAS JSON: {"titulo": "curto", "resumo": "3 frases simples", "destaques": ["..."], "riscos": ["..."], "recomendacoes": ["ação concreta para o mês", "..."]}`;
    const def = { description: 'Estrategista', prompt: `${contextoEmpresa()}\n\n---\n\n${esp?.manual || ''}`, model: esp?.modelo || 'opus', tools: esp?.ferramentas || ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebSearch', 'WebFetch'] };
    const r = await rodarClaudeLeitura(RAIZ_PROJETOS, cfg.conta || 'empresa', prompt, { estrategia: def }, 'estrategia', 20 * 60_000, [COFRE]);
    const j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
    const notaEst = config.notaEstrategia || `${String(EMPRESA()).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')}-estrategia`;
    if (fs.existsSync(path.join(COFRE, '04-projetos', notaEst + '.md'))) garantirNoIndice(notaEst, `análises e decisões estratégicas da ${EMPRESA()} registradas pelo Estrategista do escritório`);
    const lista = (t, xs) => (xs || []).length ? `### ${t}\n${xs.map(x => '- ' + x).join('\n')}\n` : '';
    entregarRotina({ sessao: 'estrategia-memorandos', agente: 'Estrategista', setor: 'geral', especialidade: 'estrategia', cwd: RAIZ_PROJETOS, conta: cfg.conta || 'empresa',
      pedido: `Memorando estratégico (${origem === 'agenda' ? 'mensal, automático' : 'pedido por você'})`,
      resposta: `## ${j.titulo || 'Memorando estratégico'}\n\n${j.resumo || ''}\n\n${lista('Destaques', j.destaques)}${lista('Riscos', j.riscos)}${lista('Recomendações', j.recomendacoes)}`,
      simples: { titulo: censurarTexto(j.titulo || 'Memorando estratégico'), resumo: censurarTexto(j.resumo || ''), feito: (j.destaques || []).slice(0, 6).map(x => censurarTexto(String(x))),
        resultado: { status: (j.riscos || []).length ? 'atencao' : 'ok', texto: (j.riscos || []).length ? `Risco principal: ${censurarTexto(String(j.riscos[0]))}` : 'Sem riscos graves no momento.' },
        proximos: (j.recomendacoes || []).slice(0, 4).map(x => censurarTexto(String(x))), termos: [], pergunta: '', bloqueio: '' } });
    estadoRotinas.estrategia = { ultima: Date.now(), rodando: false };
    notificar('entrega', `O Estrategista mandou o memorando: ${j.resumo || ''}`);
  } catch (e) {
    console.error('estratégia:', e.message);
    estadoRotinas.estrategia = { ...(estadoRotinas.estrategia || {}), rodando: false, erro: e.message, ultima: Date.now() };
  }
  gravarRotinas(); avisar();
  return { ok: true };
}
setInterval(() => {
  const { data, hora } = agoraNoFuso(), e = config.rotinas?.estrategiaMensal;
  if (e?.ativo && Number(data.slice(8)) === (e.diaDoMes || 1) && e.hora === hora && estadoRotinas.estrategiaMarca !== data) {
    estadoRotinas.estrategiaMarca = data;
    memorandoEstrategico('agenda');
  }
}, 20_000);

// ---------- deploy com o botão da dona ----------
const ARQ_DEPLOYS = path.join(DADOS, 'deploys.json');
let deploys = [];
try { deploys = JSON.parse(fs.readFileSync(ARQ_DEPLOYS, 'utf8')); } catch { deploys = []; }
const gravarDeploys = () => gravarJSON(ARQ_DEPLOYS, deploys.slice(0, 100));
const sessaoDaOrdem = ordemId => [...sessoes.values()].find(x => x.ordem === ordemId) || null;
function setorDoCwd(cwd) { return setorDaPasta(cwd); }
function registrarDeploy(d, ordemId) {
  const comando = String(d.comando || '').trim().slice(0, 2000), resumo = String(d.resumo || '').trim().slice(0, 2000);
  if (!comando || !resumo) return { erro: 'Informe o comando de deploy e o que vai ao ar.' };
  const sx = ordemId ? sessaoDaOrdem(ordemId) : null;
  const dep = { id: crypto.randomBytes(6).toString('hex'), ordem: ordemId || null, sessao: sx?.id || null, agente: sx?.nome || 'agente',
    setor: sx?.setor || setorDoCwd(d.cwd), cwd: String(d.cwd || ''), conta: sx?.conta || 'empresa', comando: censurarTexto(comando), resumo: censurarTexto(resumo),
    verificar: censurarTexto(String(d.verificar || '')).slice(0, 2000), status: 'aguardando', criado: Date.now() };
  deploys.unshift(dep); gravarDeploys(); avisar();
  notificar('esperando', `${dep.agente} preparou uma publicação em ${nomeSetor(dep.setor)}: ${curto(semQuebra(dep.resumo), 160)}. Abra o chat para apertar Publicar.`);
  return { ok: true, id: dep.id, mensagem: 'Pedido de publicação registrado. A dona precisa apertar Publicar no chat do escritório. Pare aqui e explique no resumo final o que vai ao ar.' };
}
async function publicarDeploy(id) {
  const dep = deploys.find(x => x.id === id);
  if (!dep) return { erro: 'Pedido de publicação não encontrado.' };
  if (dep.status !== 'aguardando') return { erro: 'Esse pedido já foi tratado.' };
  const pasta = fs.existsSync(dep.cwd) ? dep.cwd : pastaDoSetor(dep.setor);
  if (!pasta) return { erro: 'Não achei a pasta do projeto.' };
  const pedido = `A dona apertou PUBLICAR. Você está autorizado a publicar em produção ESTE pedido, e só ele.
O que vai ao ar: ${dep.resumo}
Comando de deploy preparado pelo colega ${dep.agente}: ${dep.comando}
Como verificar depois: ${dep.verificar || '(defina você uma verificação simples: saúde da API, uma tela principal, logs sem erro)'}

Antes: confira git status/branch, migrations pendentes, variáveis de ambiente novas e se há backup recente do banco (faça um se houver migration). Se algo estiver errado, NÃO publique: explique o que falta.
Depois: verifique a aplicação no ar e diga se ficou tudo verde.`;
  const r = await novaOrdem({ setor: dep.setor, papel: 'devops', pedido, conta: dep.conta, modo: 'executar' }, 'publicar', 'publicar', { autorizarDeploy: true, deploy: dep.id, pedidoVisivel: `Publicar: ${curto(semQuebra(dep.resumo), 120)}` });
  if (r.erro) return r;
  if (!sessoes.size) { /* nada */ }
  // a novaOrdem cria ordem com papel fixo: não precisa de triagem
  const o = ordens.get(r.id); if (o) o.triada = true;
  dep.status = 'publicando'; dep.ordemPublicacao = r.id; dep.aprovado = Date.now();
  gravarDeploys(); avisar();
  return { ok: true };
}
function cancelarDeploy(id) {
  const dep = deploys.find(x => x.id === id);
  if (!dep || dep.status !== 'aguardando') return { erro: 'Esse pedido não está aguardando.' };
  dep.status = 'cancelado'; dep.fim = Date.now(); gravarDeploys(); avisar();
  return { ok: true };
}

// ---------- prévias (homologação) com link no Tailscale ----------
const ARQ_PREVIAS = path.join(DADOS, 'previas.json');
let previas = [];
try { previas = JSON.parse(fs.readFileSync(ARQ_PREVIAS, 'utf8')); } catch { previas = []; }
const gravarPrevias = () => gravarJSON(ARQ_PREVIAS, previas.slice(0, 100));
const hostTailscale = () => String((config.origensPermitidas || [])[0] || '').split(':')[0];
async function registrarPrevia(d, ordemId) {
  const porta = Number(d.porta);
  if (!(porta >= 4900 && porta <= 4999)) return { erro: 'Porta da prévia precisa estar entre 4900 e 4999.' };
  if (!/^escritorio-previa-[0-9]+-[0-9]+$/.test(String(d.unidade || ''))) return { erro: 'Unidade inválida.' };
  const host = hostTailscale();
  if (!host) return { erro: 'Endereço do Tailscale não configurado (origensPermitidas no config.json).' };
  const usadas = new Set(previas.filter(x => x.status === 'ativa').map(x => x.https));
  let https = 0;
  for (let k = 8444; k <= 8470; k++) if (!usadas.has(k)) { https = k; break; }
  if (!https) return { erro: 'Já tem prévias demais abertas. Encerre alguma.' };
  const r = await rodar('tailscale', ['serve', '--bg', `--https=${https}`, `http://127.0.0.1:${porta}`], null, 30_000);
  if (r.erro && !/already|serve/.test(r.saida + r.stderr)) { console.error('prévia:', r.saida + r.stderr); return { erro: 'Não consegui publicar a prévia no Tailscale.' }; }
  const sx = ordemId ? sessaoDaOrdem(ordemId) : null;
  const pv = { id: crypto.randomBytes(6).toString('hex'), ordem: ordemId || null, sessao: sx?.id || null, agente: sx?.nome || 'agente', setor: sx?.setor || setorDoCwd(d.cwd),
    porta, https, unidade: d.unidade, url: `https://${host}:${https}/`, descricao: censurarTexto(String(d.descricao || '')).slice(0, 500), status: 'ativa', criada: Date.now(), expira: Date.now() + 24 * 3600_000 };
  previas.unshift(pv); gravarPrevias(); avisar();
  notificar('esperando', `${pv.agente} subiu uma prévia de ${nomeSetor(pv.setor)}: ${pv.descricao}. Link: ${pv.url}`);
  return { ok: true, url: pv.url, mensagem: `Prévia publicada para a dona: ${pv.url} (vale 24h). Mande esse link no seu resumo e espere a aprovação antes de publicar em produção.` };
}
async function encerrarPrevia(id, motivo = 'encerrada') {
  const pv = previas.find(x => x.id === id);
  if (!pv || pv.status !== 'ativa') return { erro: 'Prévia não está ativa.' };
  await rodar('tailscale', ['serve', `--https=${pv.https}`, 'off'], null, 20_000);
  await rodar('systemctl', ['stop', pv.unidade], null, 20_000);
  pv.status = motivo; pv.fim = Date.now(); gravarPrevias(); avisar();
  return { ok: true };
}
setInterval(() => { for (const pv of previas) if (pv.status === 'ativa' && Date.now() > pv.expira) encerrarPrevia(pv.id, 'expirada'); }, 5 * 60_000);

// ---------- especialistas que melhoram sozinhos ----------
const ARQ_APRENDIZADO = path.join(DADOS, 'aprendizado.json');
let aprendizado = { processados: [], propostas: [], rodando: false };
try { aprendizado = { ...aprendizado, ...JSON.parse(fs.readFileSync(ARQ_APRENDIZADO, 'utf8')), rodando: false }; } catch { /* primeira vez */ }
const gravarAprendizado = () => gravarJSON(ARQ_APRENDIZADO, { ...aprendizado, processados: aprendizado.processados.slice(-2000), propostas: aprendizado.propostas.slice(0, 100) });
// lições: recusas da dona (com comentário) e devoluções do QA (com os problemas)
function licoesPendentes() {
  const feitas = new Set(aprendizado.processados), por = {};
  for (const r of relatorios) {
    const esp = r.especialidade;
    if (!esp || esp === 'generalista' || !lerEspecialista(esp)) continue;
    if (r.avaliacao?.tipo === 'refazer' && r.avaliacao.comentario && !feitas.has('r:' + r.id))
      (por[esp] ||= []).push({ chave: 'r:' + r.id, tipo: 'recusa', projeto: nomeSetor(r.setor), pedido: curto(semQuebra(r.pedido), 200), licao: r.avaliacao.comentario });
    if (r.revisao && !r.revisao.aprovado && (r.revisao.problemas || []).length && !feitas.has('q:' + r.id))
      (por[esp] ||= []).push({ chave: 'q:' + r.id, tipo: 'qa', projeto: nomeSetor(r.setor), pedido: curto(semQuebra(r.pedido), 200), licao: r.revisao.problemas.join(' | ') });
  }
  return por;
}
async function revisarManuais(origem = 'agenda') {
  if (aprendizado.rodando) return { erro: 'Já estou revisando os manuais.' };
  const por = licoesPendentes(), minimo = config.rotinas?.aprendizado?.minimoLicoes || 1;
  const alvos = Object.entries(por).filter(([, ls]) => ls.length >= minimo);
  if (!alvos.length) return { ok: true, mensagem: 'Nenhuma lição nova desde a última revisão.' };
  aprendizado.rodando = true; avisar();
  const conta = config.rotinas?.aprendizado?.conta || 'empresa';
  try {
    for (const [esp, licoes] of alvos) {
      const e = lerEspecialista(esp);
      const prompt = `Você é o especialista "${e.nome}" da ${EMPRESA()} revisando o SEU manual de trabalho com base nas lições recentes.
Lições (recusas da dona e problemas que o QA encontrou no seu trabalho):
${licoes.map((l, k) => `${k + 1}. [${l.tipo === 'recusa' ? 'a dona pediu para refazer' : 'o QA devolveu'}] projeto ${l.projeto} · pedido: ${l.pedido}\n   lição: ${l.licao}`).join('\n')}

Manual atual:
<<<
${e.manual}
>>>

Proponha ajustes PEQUENOS e concretos no manual para não repetir esses erros (regras gerais ou específicas de um projeto, como "no projeto X, …"). Não reescreva o que já funciona; mantenha o estilo e o tamanho parecidos.
Responda APENAS JSON: {"resumo": "1 a 2 frases simples do que aprendeu", "mudancas": ["o que muda no manual, em português simples", "..."], "manualNovo": "manual completo atualizado, em Markdown"}`;
      const args = ['--wait', '--pipe', '--collect', '--quiet', '--property=WorkingDirectory=/tmp', '--property=RuntimeMaxSec=300',
        '--setenv=HOME=/root', '--setenv=ESCRITORIO_IGNORAR=1', '--setenv=PATH=' + (process.env.PATH || '/usr/local/bin:/usr/bin:/bin')];
      args.push(...envConta(conta));
      args.push(CLAUDE_BIN, '-p', prompt, '--model', 'sonnet', '--tools', '', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text');
      const r = await rodar('systemd-run', args, null, 330_000);
      let j; try { j = JSON.parse(r.saida.slice(r.saida.indexOf('{'), r.saida.lastIndexOf('}') + 1)); } catch { console.error('aprendizado sem JSON:', esp); continue; }
      const novo = String(j.manualNovo || '').replace(/^---[\s\S]*?---/, '').trim();
      if (novo.length < 200) continue;
      aprendizado.propostas.unshift({ id: crypto.randomBytes(6).toString('hex'), especialidade: esp, nome: e.nome, licoes, resumo: censurarTexto(String(j.resumo || '')).slice(0, 600),
        mudancas: (Array.isArray(j.mudancas) ? j.mudancas : []).slice(0, 8).map(x => censurarTexto(String(x)).slice(0, 300)), manualAtual: e.manual, manualNovo: novo.slice(0, 12000),
        status: 'aguardando', criada: Date.now(), origem });
      aprendizado.processados.push(...licoes.map(l => l.chave));
      gravarAprendizado(); avisar();
    }
    const n = aprendizado.propostas.filter(x => x.status === 'aguardando').length;
    if (n) notificar('esperando', `${n} especialista(s) propuseram melhorias no próprio manual. Abra Ajustes → Melhorias da equipe para aprovar.`);
  } finally { aprendizado.rodando = false; gravarAprendizado(); avisar(); }
  return { ok: true };
}
function decidirProposta(id, aprovar) {
  const pr = aprendizado.propostas.find(x => x.id === id);
  if (!pr || pr.status !== 'aguardando') return { erro: 'Essa proposta não está aguardando.' };
  if (aprovar) {
    const arq = path.join(DIR_ESPECIALISTAS, pr.especialidade + '.md');
    const bruto = fs.readFileSync(arq, 'utf8'), cab = (bruto.match(/^---\n[\s\S]*?\n---\n/) || [''])[0];
    const hist = path.join(DIR_ESPECIALISTAS, '.historico');
    fs.mkdirSync(hist, { recursive: true });
    fs.writeFileSync(path.join(hist, `${pr.especialidade}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`), bruto);
    fs.writeFileSync(arq, `${cab.replace(/\natualizado: .*$/m, '').replace(/\n---\n$/, `\natualizado: ${diaDe(Date.now())} (aprendeu com as lições)\n---\n`)}\n${pr.manualNovo}\n`);
    infoEspecialistas = resumoEspecialistas();
  }
  pr.status = aprovar ? 'aprovada' : 'recusada'; pr.decidida = Date.now();
  gravarAprendizado(); avisar();
  return { ok: true };
}
setInterval(() => {
  const { data, hora, dia } = agoraNoFuso(), a = config.rotinas?.aprendizado;
  if (a?.ativo && a.dia === dia && a.hora === hora && aprendizado.marca !== data) { aprendizado.marca = data; revisarManuais('agenda'); }
}, 20_000);

// ---------- histórico ao vivo (gráficos do telão) ----------
const aoVivo = [];
setInterval(() => {
  const ag = [...sessoes.values()];
  aoVivo.push({ t: Date.now(), trabalhando: ag.filter(x => x.estado === 'trabalhando').length, esperando: ag.filter(x => x.estado === 'esperando').length,
    ordens: [...ordens.values()].filter(o => o.ativa).length });
  if (aoVivo.length > 180) aoVivo.shift();
}, 60_000);

// ---------- conquistas e funcionário do mês ----------
const ARQ_CONQUISTAS = path.join(DADOS, 'conquistas.json');
let conquistas = [];
try { conquistas = JSON.parse(fs.readFileSync(ARQ_CONQUISTAS, 'utf8')); } catch { conquistas = []; }
const contagem = { deploysOk: 0, testesOk: 0 };
try { Object.assign(contagem, JSON.parse(fs.readFileSync(path.join(DADOS, 'contagem.json'), 'utf8'))); } catch { /* começa do zero */ }
function ganhar(id, titulo, desc) {
  if (conquistas.some(c => c.id === id)) return;
  const c = { id, titulo, desc, em: Date.now() };
  conquistas.push(c);
  gravarJSON(ARQ_CONQUISTAS, conquistas);
  ultimaConquista = c;
  notificar('conquista', `Nova conquista: ${titulo}. ${desc}`);
  avisar();
}
let ultimaConquista = null;
function verificarConquistas(s, resultado) {
  if (resultado) {
    contagem[resultado.tipo === 'deploy' ? 'deploysOk' : 'testesOk']++;
    gravarJSON(path.join(DADOS, 'contagem.json'), contagem);
    if (resultado.tipo === 'deploy') {
      ganhar('deploy-1', 'Primeiro deploy', 'O primeiro deploy deu certo.');
      if (contagem.deploysOk >= 10) ganhar('deploy-10', '10 deploys', 'Dez deploys com sucesso.');
      if (contagem.deploysOk >= 50) ganhar('deploy-50', '50 deploys', 'Cinquenta deploys com sucesso.');
    } else {
      ganhar('teste-1', 'Testes verdes', 'A primeira bateria de testes passou.');
      if (contagem.testesOk >= 25) ganhar('teste-25', '25 testes verdes', 'Vinte e cinco baterias de testes passando.');
      if (contagem.testesOk >= 100) ganhar('teste-100', '100 testes verdes', 'Cem baterias de testes passando.');
    }
    return;
  }
  const total = relatorios.length;
  ganhar('entrega-1', 'Primeira entrega', 'O primeiro relatório chegou na sua mesa.');
  for (const n of [10, 50, 100, 250, 500, 1000]) if (total >= n) ganhar('entrega-' + n, `${n} entregas`, `${n} tarefas entregues no escritório.`);
  const hoje = diaDe(Date.now()), doDia = relatorios.filter(r => diaDe(r.fim) === hoje);
  if (doDia.length >= 10) ganhar('dia-10-' + hoje.slice(0, 7), 'Dia produtivo', '10 tarefas entregues num só dia.');
  if (new Set(doDia.map(r => r.setor)).size >= 5) ganhar('setores-5-' + hoje.slice(0, 7), 'Empresa a todo vapor', 'Cinco setores trabalharam no mesmo dia.');
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSO(), hour: '2-digit', hour12: false }).format(Date.now()));
  if (h < 5) ganhar('coruja', 'Coruja', 'Uma entrega de madrugada.');
  if (s?.entregas >= 20) ganhar('especialista-' + s.nome, `${s.nome} virou Especialista`, `${s.nome} chegou a 20 entregas.`);
}
function funcionarioDoMes() {
  const mes = diaDe(Date.now()).slice(0, 7), cont = {};
  for (const r of relatorios) if (diaDe(r.fim).startsWith(mes)) cont[r.agente] = (cont[r.agente] || 0) + 1;
  const [nome, n] = Object.entries(cont).sort((a, b) => b[1] - a[1])[0] || [];
  return nome ? { nome, entregas: n } : null;
}

// ---------- consumo de tokens por projeto ----------
function consumo() {
  const porDia = {}, porSetor = {}, mes = diaDe(Date.now()).slice(0, 7);
  let estimados = 0;
  for (const r of relatorios) {
    if (r.projetoFinal || r.emRevisao) continue; // o consolidado do gerente repete o custo das tarefas
    const d = diaDe(r.fim), tk = (r.tokens?.entrada || 0) + (r.tokens?.saida || 0);
    // relatórios antigos não têm o detalhe por modelo: estima pelo preço do Sonnet
    let usd = r.custoUSD;
    if (usd == null) { estimados++; const [, e, sa, l] = precoDe('claude-sonnet-5'); usd = ((r.tokens?.entrada || 0) * e + (r.tokens?.saida || 0) * sa + (r.tokens?.cache || 0) * l) / 1e6; }
    (porDia[d] ||= { tokens: 0, tarefas: 0, usd: 0 }); porDia[d].tokens += tk; porDia[d].tarefas++; porDia[d].usd += usd;
    if (d.startsWith(mes)) { const p = (porSetor[r.setor] ||= { tokens: 0, tarefas: 0, ms: 0, usd: 0 }); p.tokens += tk; p.tarefas++; p.ms += Math.max(0, r.fim - r.inicio); p.usd += usd; }
  }
  return { porDia, porSetor, mes, limiteDia: config.limiteTokensDia || 0, estimados };
}
let alertaLimite = '';
setInterval(() => {
  const lim = config.limiteTokensDia || 0, hoje = diaDe(Date.now());
  if (!lim || alertaLimite === hoje) return;
  const usado = consumo().porDia[hoje]?.tokens || 0;
  if (usado > lim) { alertaLimite = hoje; notificar('falha', `Hoje já foram ${Math.round(usado / 1000)} mil tokens, acima do limite de ${Math.round(lim / 1000)} mil.`); }
}, 60_000);

// ---------- clima de verdade (Open-Meteo, sem chave) ----------
let clima = null;
async function atualizarClima() {
  const c = config.clima;
  if (!c?.lat || !c?.lon) { clima = null; return; }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${Number(c.lat)}&longitude=${Number(c.lon)}&current=temperature_2m,weather_code,cloud_cover,precipitation,is_day&timezone=auto`;
    const j = await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json();
    const a = j.current || {};
    clima = { cidade: c.cidade || '', temp: a.temperature_2m, codigo: a.weather_code, nuvens: a.cloud_cover, chuva: a.precipitation, dia: a.is_day === 1, em: Date.now() };
    avisar();
  } catch (e) { console.error('clima:', e.message); }
}
setTimeout(atualizarClima, 2000);
setInterval(atualizarClima, 15 * 60_000);

// resumo em linguagem simples, feito por um modelo pequeno sem ferramentas e sem os hooks do usuário
const PROMPT_RESUMO = `Você recebe o relatório técnico de um agente de programação. Explique para a dona da empresa, que NÃO é técnica, em português do Brasil simples, sem jargão (se precisar de um termo técnico, explique entre parênteses).
Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{"titulo":"frase curta do que foi feito (até 8 palavras)","resumo":"2 ou 3 frases simples","feito":["item curto","..."],"resultado":{"status":"ok|atencao|problema","texto":"1 frase"},"proximos":["passo sugerido","..."],"termos":[{"termo":"palavra técnica","explicacao":"explicação simples"}],"pergunta":"se o agente terminou fazendo uma pergunta ou pedindo uma decisão da dona, a pergunta em português simples; senão vazio","bloqueio":"se o agente disse que algo foi bloqueado ou negado por permissão, o que foi bloqueado; senão vazio"}
Use no máximo 6 itens em "feito", 4 em "proximos" e 4 em "termos". Se não houver próximos passos, use [].`;
async function resumir(rel) {
  if (config.resumoSimples === false || !rel.resposta) return;
  const conta = config.contaResumo || rel.conta || 'empresa';
  const texto = `PEDIDO:\n${rel.pedido.slice(0, 1500)}\n\nRESPOSTA DO AGENTE:\n${rel.resposta.slice(0, 7000)}\n\nARQUIVOS ALTERADOS:\n${rel.arquivos.slice(0, 30).join('\n') || '(nenhum)'}`;
  const args = ['--wait', '--pipe', '--collect', '--quiet', '--property=WorkingDirectory=/tmp', '--property=RuntimeMaxSec=180',
    '--setenv=HOME=/root', '--setenv=ESCRITORIO_IGNORAR=1', '--setenv=PATH=' + (process.env.PATH || '/usr/local/bin:/usr/bin:/bin')];
  args.push(...envConta(conta));
  args.push(CLAUDE_BIN, '-p', PROMPT_RESUMO + '\n\n' + texto, '--model', 'haiku', '--tools', '', '--setting-sources', 'project',
    '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text');
  const r = await rodar('systemd-run', args, null, 200_000);
  const bruto = r.saida.slice(r.saida.indexOf('{'), r.saida.lastIndexOf('}') + 1);
  let j;
  try { j = JSON.parse(bruto); } catch { console.error('resumo sem JSON:', (r.saida + r.stderr).slice(0, 300)); return; }
  const lista = (x, n) => (Array.isArray(x) ? x : []).map(v => (typeof v === 'string' ? v : '')).filter(Boolean).slice(0, n).map(v => censurarTexto(v).slice(0, 300));
  rel.simples = {
    titulo: censurarTexto(String(j.titulo || '')).slice(0, 90),
    resumo: censurarTexto(String(j.resumo || '')).slice(0, 700),
    feito: lista(j.feito, 6),
    resultado: { status: ['ok', 'atencao', 'problema'].includes(j.resultado?.status) ? j.resultado.status : 'ok', texto: censurarTexto(String(j.resultado?.texto || '')).slice(0, 300) },
    proximos: lista(j.proximos, 4),
    termos: (Array.isArray(j.termos) ? j.termos : []).slice(0, 4).map(t => ({ termo: String(t?.termo || '').slice(0, 40), explicacao: censurarTexto(String(t?.explicacao || '')).slice(0, 200) })).filter(t => t.termo),
    pergunta: censurarTexto(String(j.pergunta || '')).slice(0, 600),
    bloqueio: censurarTexto(String(j.bloqueio || '')).slice(0, 400),
  };
  // pergunta no fim = o agente fica esperando você, como no app
  const sx = sessoes.get(rel.sessao);
  if (rel.simples.pergunta && sx && sx.estado === 'ocioso') {
    sx.acao = 'tem uma pergunta para você';
    mudarEstado(sx, 'esperando');
    notificar('esperando', `${sx.nome} (${nomeSetor(sx.setor)}) perguntou: ${rel.simples.pergunta}`);
  }
  gravarRelatorios();
  avisar();
}

// especialidade: descoberta pelo que o agente lê, edita e roda (regras em config.json → especialidades)
let regrasPapel = [];
function compilarEspecialidades() {
  regrasPapel = (config.especialidades || []).map(e => {
    const rx = t => { try { return t ? new RegExp(t, 'i') : null; } catch { console.error('regex inválida em', e.id); return null; } };
    return { ...e, rxArquivos: rx(e.arquivos), rxComandos: rx(e.comandos) };
  });
}
compilarEspecialidades();
const especialidadeExiste = id => regrasPapel.some(e => e.id === id);
// arquivos de bastidores (do próprio Claude, rascunhos, memória, cofre) não dizem nada sobre a especialidade do trabalho
const ehBastidor = p => /\/\.claude[^/]*\/|^\/tmp\/claude-|\/scratchpad\/|\/node_modules\//.test(p) || (COFRE && p.startsWith(COFRE + '/'));
function papelDoArquivo(arq) {
  const p = String(arq || '');
  if (!p || ehBastidor(p)) return null;
  return regrasPapel.find(e => e.rxArquivos?.test(p))?.id || null;
}
function papelDoComando(cmd) {
  return regrasPapel.find(e => e.rxComandos?.test(String(cmd || '')))?.id || null;
}
function pontuarPapel(s, papel, peso) {
  if (!papel || s.papelFixo) return;
  s.pontosPapel[papel] = (s.pontosPapel[papel] || 0) + peso;
  const [melhor, pts] = Object.entries(s.pontosPapel).sort((a, b) => b[1] - a[1])[0];
  s.especialidade = pts >= 3 ? melhor : 'generalista';
}

// testes e deploys: reconhece pelo comando e decide pelo resultado
const RX_TESTE = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(jest|vitest|pytest|phpunit|rspec|mocha)\b|\bdotnet\s+test\b|\bgo\s+test\b|\bcargo\s+test\b|playwright\s+test/i;
const RX_DEPLOY = /\bdeploy\b|\bvercel\b.*--prod|\bgit\s+push\b|docker\s+compose\b.*\bup\b|\bsystemctl\s+(restart|reload)\b|\bcoolify\b/i;
function resultadoDe(ev) {
  const cmd = String(ev.tool_input?.command || '');
  const tipo = RX_DEPLOY.test(cmd) ? 'deploy' : RX_TESTE.test(cmd) ? 'teste' : null;
  if (!tipo) return null;
  const r = ev.tool_response || {};
  const codigo = r.exitCode ?? r.exit_code ?? r.returnCode ?? r.code;
  let ok;
  if (typeof codigo === 'number') ok = codigo === 0;
  else if (r.interrupted || r.is_error || r.isError) ok = false;
  else {
    const texto = (String(r.stdout || '') + '\n' + String(r.stderr || '') + (typeof r === 'string' ? r : '')).slice(-30_000);
    const semZeros = texto.replace(/\b0\s+(failed|failing|failures|errors?)\b/gi, '');
    ok = !/\b\d+\s+(failed|failing)\b|\bFAIL(ED)?\b|Tests? failed|npm ERR!|\berror\b[: ]|✗|✕|Build FAILED|exit code [1-9]/i.test(semZeros);
  }
  return { tipo, ok, em: Date.now(), comando: curto(censurar(cmd), 60) };
}

// quadro do dia
const resultadosHoje = [];
const FUSO = () => config.fusoHorario || 'America/Sao_Paulo';
const diaDe = ms => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
function resumoDoDia() {
  const hoje = diaDe(Date.now()), porSetor = {};
  let tarefas = 0, tokens = 0, testesOk = 0, testesFalha = 0;
  for (const r of relatorios) {
    if (diaDe(r.fim) !== hoje) continue;
    tarefas++;
    const tk = (r.tokens?.entrada || 0) + (r.tokens?.saida || 0);
    tokens += tk;
    const p = (porSetor[r.setor] ||= { tarefas: 0, ms: 0, tokens: 0 });
    p.tarefas++; p.ms += Math.max(0, r.fim - r.inicio); p.tokens += tk;
  }
  for (const x of resultadosHoje) if (diaDe(x.em) === hoje) (x.ok ? testesOk++ : testesFalha++);
  return { dia: hoje, tarefas, tokens, porSetor, testesOk, testesFalha };
}

// ---------- ordens: tarefas mandadas pelo escritório ----------
// Cada ordem roda `claude -p` numa unidade systemd própria (fora do sandbox deste serviço), em modo auto.
const ordens = new Map();
const ARQ_ORDENS = path.join(DADOS, 'ordens.log');
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const MODELOS = ['', 'sonnet', 'opus', 'haiku', 'fable'];
function pastaDoSetor(id) {
  const s = config.setores.find(x => x.id === id);
  return (s?.pastas || []).find(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) || null;
}
function rodar(cmd, args, env, limite = 15_000) {
  return new Promise(ok => {
    execFile(cmd, args, { timeout: limite, maxBuffer: 4 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env },
      (erro, saida, err) => ok({ erro, saida: String(saida || ''), stderr: String(err || '') }));
  });
}
async function contaLogada(conta) {
  const env = { HOME: os.homedir(), ...(dirConta(conta) ? { CLAUDE_CONFIG_DIR: dirConta(conta) } : {}) };
  const r = await rodar(CLAUDE_BIN, ['auth', 'status'], env);
  try {
    const j = JSON.parse(r.saida.slice(r.saida.indexOf('{')));
    // só aceita login pela assinatura (claude.ai); chave de API seria cobrada à parte
    return j.loggedIn === true && j.authMethod === 'claude.ai';
  } catch { return false; }
}
// anexos da ordem: imagens, PDFs e textos que o agente pode abrir com a ferramenta Read
const DIR_ANEXOS = path.join(DADOS, 'anexos');
const TIPOS_ANEXO = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|log|xml|ya?ml|html?|sql|tsv)$/i;
const MAX_ANEXO = 15 * 1024 * 1024, MAX_ANEXOS = 10;
function nomeSeguro(n, usados) {
  let base = path.basename(String(n || 'arquivo')).normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'arquivo';
  if (base.startsWith('.')) base = 'arquivo' + base;
  let nome = base, k = 1;
  while (usados.has(nome.toLowerCase())) nome = base.replace(/(\.[^.]*)?$/, `-${++k}$1`);
  usados.add(nome.toLowerCase());
  return nome;
}
function salvarAnexos(id, anexos) {
  if (!Array.isArray(anexos) || !anexos.length) return { lista: [] };
  if (anexos.length > MAX_ANEXOS) return { erro: `No máximo ${MAX_ANEXOS} anexos por tarefa.` };
  const dir = path.join(DIR_ANEXOS, id), usados = new Set(), lista = [];
  for (const a of anexos) {
    const nome = nomeSeguro(a?.nome, usados);
    if (!TIPOS_ANEXO.test(nome)) return { erro: `O tipo de "${nome}" não é aceito. Use imagem, PDF ou texto.` };
    const buf = Buffer.from(String(a?.dados || ''), 'base64');
    if (!buf.length) return { erro: `"${nome}" veio vazio.` };
    if (buf.length > MAX_ANEXO) return { erro: `"${nome}" passa de 15 MB.` };
    lista.push({ nome, buf });
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const { nome, buf } of lista) fs.writeFileSync(path.join(dir, nome), buf, { mode: 0o600 });
  return { dir, lista: lista.map(({ nome, buf }) => ({ nome, tamanho: buf.length })) };
}

// validação comum; a ordem entra na fila e o despachante inicia quando houver vaga
async function novaOrdem({ setor, pedido, conta, modelo, papel, anexos, sessao, modo }, ip, origem = 'painel', extra = {}) {
  modo = modo === 'conversa' ? 'conversa' : 'executar';
  let pasta, s = null;
  if (sessao) {
    // continuar uma sessão existente: responder o agente ou pedir ajuste
    s = sessoes.get(String(sessao));
    if (!s) return { erro: 'Esse agente não está mais no escritório.' };
    if (s.estado === 'trabalhando' && !(s.ordem && !ordens.get(s.ordem)?.ativa)) return { erro: 'Esse agente ainda está trabalhando. Espere ele terminar.' };
    if ([...ordens.values()].some(o => o.sessao === s.id && (o.ativa || o.naFila))) return { erro: 'Já tem uma continuação pendente para esse agente.' };
    pasta = s.cwd; setor = s.setor; conta = s.conta;
    try { if (!fs.statSync(pasta).isDirectory()) throw 0; } catch { return { erro: 'A pasta desse agente não existe mais.' }; }
  } else {
    pasta = pastaDoSetor(setor);
    if (!pasta) return { erro: 'Esse setor não tem uma pasta válida no config.json.' };
  }
  pedido = String(pedido || '').trim();
  if (!pedido) return { erro: 'Escreva o pedido.' };
  if (pedido.length > 6000) return { erro: 'Pedido grande demais (máximo 6000 caracteres).' };
  if (!['pessoal', 'empresa'].includes(conta)) return { erro: 'Conta inválida.' };
  modelo = modelo || '';
  if (!MODELOS.includes(modelo)) return { erro: 'Modelo inválido.' };
  papel = papel || '';
  if (papel && !especialidadeExiste(papel)) return { erro: 'Especialidade inválida.' };
  if (!(await contaLogada(conta))) {
    return { erro: `A conta ${conta} do Claude não está logada pela assinatura (claude.ai) na VPS. O escritório não usa API. Rode "claude auth login"${dirConta(conta) ? ' com CLAUDE_CONFIG_DIR=' + dirConta(conta) : ''} no terminal ou escolha a outra conta.` };
  }
  if ([...ordens.values()].filter(o => o.naFila).length >= 30) return { erro: 'A fila já tem 30 tarefas. Espere algumas andarem.' };
  const id = crypto.randomBytes(6).toString('hex');
  const ax = salvarAnexos(id, anexos);
  if (ax.erro) return { erro: ax.erro };
  const o = { id, unidade: `escritorio-ordem-${id}`, setor, pasta, conta, modelo, papel, sessao: s?.id || null, origem, modo,
    pedido: curto(censurar(extra.pedidoVisivel || pedido), 160), anexos: ax.lista, dirAnexos: ax.dir, textoCompleto: pedido, criada: Date.now(), inicio: null, ativa: false, naFila: true,
    tarefa: extra.tarefa || null, revisoes: extra.revisoes || 0, pedidoVisivel: extra.pedidoVisivel || null,
    autorizarDeploy: !!extra.autorizarDeploy, deploy: extra.deploy || null, triada: !!extra.autorizarDeploy, convidado: extra.convidado || null };
  ordens.set(id, o);
  fs.appendFile(ARQ_ORDENS, JSON.stringify({ id, setor, conta, modelo, papel, sessao: o.sessao, origem, ip, pedido: censurarTexto(pedido), criada: o.criada }) + '\n', { mode: 0o600 }, () => {});
  despachar();
  return { ok: true, id, naFila: o.naFila };
}

// ---------- agenda: tarefas que rodam sozinhas em dia e hora marcados ----------
const ARQ_AGENDA = path.join(DADOS, 'agenda.json');
let agenda = [];
try { agenda = JSON.parse(fs.readFileSync(ARQ_AGENDA, 'utf8')); } catch { agenda = []; }
const gravarAgenda = () => gravarJSON(ARQ_AGENDA, agenda, 1);
function agoraNoFuso() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(Date.now()).map(x => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, dia };
}
async function salvarAgendamento(d) {
  const repetir = ['uma-vez', 'diario', 'dias'].includes(d.repetir) ? d.repetir : 'uma-vez';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.hora || ''))) return { erro: 'Hora inválida (use HH:MM).' };
  if (repetir === 'uma-vez' && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.data || ''))) return { erro: 'Escolha a data.' };
  const dias = repetir === 'dias' ? [...new Set((d.dias || []).map(Number).filter(n => n >= 0 && n <= 6))] : [];
  if (repetir === 'dias' && !dias.length) return { erro: 'Escolha pelo menos um dia da semana.' };
  if (!pastaDoSetor(d.setor)) return { erro: 'Setor sem pasta válida.' };
  const pedido = String(d.pedido || '').trim();
  if (!pedido || pedido.length > 6000) return { erro: 'Escreva o pedido (até 6000 caracteres).' };
  if (!['pessoal', 'empresa'].includes(d.conta) || !MODELOS.includes(d.modelo || '') || (d.papel && !especialidadeExiste(d.papel))) return { erro: 'Opções inválidas.' };
  if (agenda.length >= 50) return { erro: 'A agenda já tem 50 tarefas.' };
  const item = { id: crypto.randomBytes(6).toString('hex'), setor: d.setor, pedido, conta: d.conta, modelo: d.modelo || '', papel: d.papel || '',
    repetir, hora: d.hora, data: repetir === 'uma-vez' ? d.data : null, dias, ativo: true, criada: Date.now(), ultima: null };
  agenda.push(item); gravarAgenda(); avisar();
  return { ok: true, id: item.id };
}
setInterval(async () => {
  const { data, hora, dia } = agoraNoFuso();
  for (const a of agenda) {
    if (!a.ativo || a.ultima === `${data} ${hora}` || hora !== a.hora) continue;
    if (a.repetir === 'uma-vez' && a.data !== data) continue;
    if (a.repetir === 'dias' && !a.dias.includes(dia)) continue;
    a.ultima = `${data} ${hora}`;
    if (a.repetir === 'uma-vez') a.ativo = false;
    const r = await novaOrdem({ setor: a.setor, pedido: a.pedido, conta: a.conta, modelo: a.modelo, papel: a.papel }, 'agenda', 'agenda');
    a.resultado = r.erro ? `não rodou: ${r.erro}` : 'rodou';
    console.log(`agenda ${a.id}: ${a.resultado}`);
    gravarAgenda(); avisar();
  }
}, 20_000);

// ---------- especialistas de verdade: manual, ferramentas e modelo de cada área (pasta especialistas/) ----------
const DIR_ESPECIALISTAS = path.join(RAIZ, 'especialistas');
function lerEspecialista(id) {
  if (!/^[a-z0-9-]+$/.test(id || '')) return null;
  try {
    const bruto = fs.readFileSync(path.join(DIR_ESPECIALISTAS, id + '.md'), 'utf8');
    const m = bruto.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) return null;
    const meta = Object.fromEntries(m[1].split('\n').map(l => l.split(/:\s*/)).filter(x => x.length >= 2).map(([k, ...v]) => [k.trim(), v.join(': ').trim()]));
    const ferramentas = !meta.ferramentas || meta.ferramentas === 'todas' ? null : meta.ferramentas.split(',').map(x => x.trim()).filter(Boolean);
    return { id, nome: meta.nome || id, modelo: meta.modelo || '', descricao: meta.descricao || '', ferramentas, manual: m[2].trim() };
  } catch { return null; }
}
const contextoEmpresa = () => { try { return fs.readFileSync(path.join(DIR_ESPECIALISTAS, '_empresa.md'), 'utf8').trim(); } catch { return ''; } };
function resumoEspecialistas() {
  return Object.fromEntries((config.especialidades || []).map(e => {
    const x = lerEspecialista(e.id);
    return [e.id, x ? { modelo: x.modelo, descricao: x.descricao, soLeitura: !!x.ferramentas && !x.ferramentas.includes('Edit'), semComandos: !!x.ferramentas && !x.ferramentas.includes('Bash') } : null];
  }));
}

// inicia as ordens da fila respeitando o limite de agentes ao mesmo tempo
let despachando = false;
async function despachar() {
  if (despachando) return;
  despachando = true;
  try {
    const limite = config.maxOrdens || 4;
    for (const o of [...ordens.values()].filter(x => x.naFila).sort((a, b) => a.criada - b.criada)) {
      if ([...ordens.values()].filter(x => x.ativa).length >= limite) break;
      await iniciarOrdem(o);
    }
  } finally { despachando = false; avisar(); }
}
// triagem com o Haiku: qual especialista é o certo para o pedido
async function triar(o) {
  const lista = regrasPapel.map(e => `${e.id}: ${e.nome} — ${lerEspecialista(e.id)?.descricao || ''}`).join('\n');
  const pastas = (setoresComPastas().find(x => x.id === o.setor)?.pastas || [o.pasta]);
  const stack = contextoEmpresa().split('\n').filter(l => pastas.some(p => l.includes(p) || l.includes(path.basename(p)))).join('\n').slice(0, 1500);
  const prompt = `Escolha o especialista MAIS adequado para executar o pedido abaixo, numa software house. Pedido do projeto "${nomeSetor(o.setor)}":\n«${o.textoCompleto.slice(0, 2500)}»\n\n${stack ? `O que é o projeto e a stack dele:\n${stack}\n\n` : ''}Especialistas:\n${lista}\n\nRegras: escolha pela tecnologia ou área principal que o pedido vai mexer (ex.: tela Angular → angular; API NestJS → nestjs; app Flutter → mobile; banco/migration → banco; deploy → deploy). Use "estrategia" só para decisões de negócio da empresa inteira e "generalista" só se nenhum servir mesmo.\nResponda APENAS com o id, sem mais nada.`;
  const args = ['--wait', '--pipe', '--collect', '--quiet', '--property=WorkingDirectory=/tmp', '--property=RuntimeMaxSec=90',
    '--setenv=HOME=/root', '--setenv=ESCRITORIO_IGNORAR=1', '--setenv=PATH=' + (process.env.PATH || '/usr/local/bin:/usr/bin:/bin')];
  args.push(...envConta(o.conta));
  args.push(CLAUDE_BIN, '-p', prompt, '--model', 'haiku', '--tools', '', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text');
  const r = await rodar('systemd-run', args, null, 100_000);
  const id = (r.saida.toLowerCase().match(/[a-z0-9-]+/g) || []).find(x => especialidadeExiste(x));
  return id || '';
}

async function iniciarOrdem(o) {
  if (!o.sessao && !o.triada && config.triagem !== false) {
    o.triada = true; o.triando = true; avisar();
    const escolhido = await triar(o).catch(() => '');
    o.triando = false;
    if (escolhido && escolhido !== o.papel) {
      if (o.papel) o.repasse = { de: o.papel, para: escolhido, em: Date.now() };
      o.papel = escolhido;
    }
  }
  if (o.convidado && o.papel === 'estrategia') o.papel = 'produto';
  let pedido = o.textoCompleto;
  if (o.anexos.length) pedido += `\n\nArquivos anexados (abra com a ferramenta Read antes de começar):\n` + o.anexos.map(a => `- ${path.join(o.dirAnexos, a.nome)}`).join('\n');
  const args = ['--unit=' + o.unidade, '--collect', '--quiet', '--property=WorkingDirectory=' + o.pasta, '--property=RuntimeMaxSec=4h',
    '--setenv=HOME=/root', '--setenv=ESCRITORIO_ORDEM=' + o.id, '--setenv=PATH=' + (process.env.PATH || '/usr/local/bin:/usr/bin:/bin')];
  args.push(...envConta(o.conta));
  if (o.autorizarDeploy) args.push('--setenv=ESCRITORIO_DEPLOY_AUTORIZADO=1');
  if (o.convidado) args.push(...trancaDoConvidado(o));
  // conversa = modo de planejamento: o agente lê e responde, mas não altera nada
  args.push(CLAUDE_BIN, '-p', pedido, '--permission-mode', o.modo === 'conversa' ? 'plan' : 'auto');
  if (o.sessao) args.push('--resume', o.sessao);
  if (o.anexos.length) args.push('--add-dir', o.dirAnexos);
  // especialista: na continuação, mantém o especialista que a sessão já tinha
  const sessaoAnterior = o.sessao && sessoes.get(o.sessao);
  const papel = o.papel || (sessaoAnterior?.papelFixo ? sessaoAnterior.especialidade : '');
  const esp = lerEspecialista(papel);
  if (esp) {
    const delegar = `\n\n## Trabalho em equipe\nSe o pedido (ou parte dele) for da área de outro especialista, NÃO faça improvisando: delegue essa parte ao especialista certo com a ferramenta Agent (subagent_type = id do especialista) e junte o resultado na sua resposta final. Se o pedido inteiro for de outra área, delegue tudo e diga no final quem fez. Especialistas da casa: ${regrasPapel.filter(e => e.id !== esp.id).map(e => `${e.id} (${e.nome})`).join(', ')}.`;
    const def = { description: esp.descricao || esp.nome, prompt: o.convidado ? `${contextoConvidado(o)}\n\n---\n\n${limparParaConvidado(esp.manual, o.setor)}${delegar}` : `${contextoEmpresa()}\n\n---\n\n${esp.manual}${delegar}` };
    const modelo = o.modelo || esp.modelo;
    if (modelo) def.model = modelo;
    if (esp.ferramentas) def.tools = [...new Set([...esp.ferramentas, 'Agent'])];
    // os outros especialistas ficam disponíveis como subagentes para a delegação
    const time = { [esp.id]: def };
    for (const e of regrasPapel) {
      if (e.id === esp.id) continue;
      const x = lerEspecialista(e.id);
      if (!x) continue;
      const d = { description: `${x.nome}: ${x.descricao}`, prompt: `Você foi chamado por um colega do escritório da ${EMPRESA()} para cuidar da parte da sua área. Siga as regras da casa: trabalhe só na pasta atual, não exponha segredos, produção só com pedido explícito.\n\n${o.convidado ? limparParaConvidado(x.manual, o.setor) : x.manual}` };
      if (x.modelo) d.model = x.modelo;
      if (x.ferramentas) d.tools = x.ferramentas;
      time[e.id] = d;
    }
    let json = JSON.stringify(time);
    if (json.length > 110_000) json = JSON.stringify({ [esp.id]: def }); // limite de tamanho de argumento
    args.push('--agents', json, '--agent', esp.id);
    if (o.modelo) args.push('--model', o.modelo);
  } else if (o.modelo) args.push('--model', o.modelo);
  // memória do projeto: notas do cofre para ler antes de começar
  const notas = o.convidado ? [] : notasDoProjeto(o.setor); // convidado não lê o cofre
  const ehEstrategista = !o.convidado && (o.papel || (sessaoAnterior?.papelFixo ? sessaoAnterior.especialidade : '')) === 'estrategia'; // o estrategista vê a empresa inteira: nunca para convidado
  if ((notas.length || ehEstrategista) && fs.existsSync(COFRE)) args.push('--add-dir', COFRE);
  if (ehEstrategista && o.pasta !== RAIZ_PROJETOS) args.push('--add-dir', RAIZ_PROJETOS);
  const instrucao = [esp ? null : (o.convidado ? contextoConvidado(o) : contextoEmpresa()),
    notas.length ? `Memória deste projeto no cofre (leia as notas relevantes antes de começar; não edite o cofre):\n${notas.map(n => '- ' + n).join('\n')}` : null,
    ehEstrategista ? panoramaDaEmpresa() : null,
    o.modo === 'conversa' && o.convidado ? 'O convidado está conversando com você pelo escritório, como num chat. Responda direto, curto e em português simples. Nesta etapa NÃO altere nada: só leia, pense e responda. Se for preciso executar algo, explique o que vai fazer e diga que ele pode clicar em Executar.'
      : o.modo === 'conversa' ? 'A dona da empresa está conversando com você pelo escritório, como num chat. Responda direto, curto e em português simples, sem jargão. Nesta etapa NÃO altere nada: só leia, pense e responda. Se for preciso executar algo, explique em poucas linhas o que vai fazer e diga que ela pode clicar em Executar.'
      : o.sessao ? 'A dona respondeu pelo escritório e pediu para executar. Faça o combinado e, no fim, explique em português simples o que foi feito.' : null].filter(Boolean).join('\n\n');
  if (instrucao) args.push('--append-system-prompt', instrucao);
  o.naFila = false;
  const r = await rodar('systemd-run', args);
  if (r.erro) { console.error('ordem:', r.saida + r.stderr); o.erro = 'Não consegui iniciar o agente.'; o.fim = Date.now(); return; }
  o.ativa = true; o.inicio = Date.now();
  console.log(`ordem ${o.id} iniciada em ${o.pasta} (${o.conta})${o.sessao ? ' continuando ' + o.sessao.slice(0, 8) : ''}`);
}
async function pararOrdem(id) {
  const o = ordens.get(id);
  if (!o) return { erro: 'Ordem não encontrada.' };
  if (o.naFila) { o.naFila = false; o.cancelada = true; o.fim = Date.now(); despachar(); return { ok: true }; }
  await rodar('systemctl', ['stop', o.unidade]);
  o.ativa = false;
  fs.appendFile(ARQ_ORDENS, JSON.stringify({ id, parada: Date.now() }) + '\n', () => {});
  return { ok: true };
}
setInterval(async () => {
  for (const o of ordens.values()) {
    if (!o.ativa) continue;
    const r = await rodar('systemctl', ['is-active', o.unidade]);
    if (!/^(active|activating)/.test((r.saida + r.stderr).trim())) {
      o.ativa = false;
      setTimeout(despachar, 500);
      o.fim = Date.now();
      // sem sessão registrada pelos hooks = o agente nem começou; pega o motivo no log da unidade
      const comecou = [...sessoes.values()].some(s => s.ordem === o.id) || o.interrompidaPara;
      if (!comecou) {
        const log = await rodar('journalctl', ['-u', o.unidade, '-n', '30', '-o', 'cat', '--no-pager']);
        const linha = (log.saida + log.stderr).split('\n').map(l => l.trim()).filter(l => l && !/inotify|systemd-run|Main process|Failed with result|Consumed|Started|Deactivated/.test(l)).pop() || 'o agente saiu sem começar';
        o.erro = /OAuth|authenticate|log ?in|not logged/i.test(linha)
          ? `A conta ${o.conta} do Claude está deslogada na VPS. Rode "claude auth login"${dirConta(o.conta) ? ' com CLAUDE_CONFIG_DIR=' + dirConta(o.conta) : ''} no terminal ou use a outra conta.`
          : curto(censurar(linha), 200);
        console.error(`ordem ${o.id} falhou: ${linha}`);
        notificar('falha', `A tarefa para ${nomeSetor(o.setor)} não começou: ${o.erro}`);
        if (o.tarefa) { const p = projetos.find(x => x.id === o.tarefa.projeto), t = p?.tarefas[o.tarefa.tarefa]; if (t && t.status !== 'feito') { t.status = 'erro'; t.erro = o.erro; avancarProjeto(p); } }
      }
      avisar();
    }
  }
  for (const [id, o] of ordens) if (!o.ativa && !o.naFila && Date.now() - (o.fim || o.inicio || o.criada) > 6 * 3600_000) ordens.delete(id);
}, 20_000);

const curto = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
function censurarTexto(t) {
  return String(t || '')
    .replace(/(bearer\s+|token[=:]\s*|senha[=:]\s*|password[=:]\s*|apikey[=:]\s*|key[=:]\s*)\S+/gi, '$1•••')
    .replace(/[A-Za-z0-9_\-+=]{28,}/g, '•••');
}
function censurar(t) {
  return String(t || '')
    .replace(/(bearer\s+|token[=:]\s*|senha[=:]\s*|password[=:]\s*|apikey[=:]\s*|key[=:]\s*)\S+/gi, '$1•••')
    .replace(/[A-Za-z0-9_\-+=]{28,}/g, '•••')
    .replace(/\s+/g, ' ')
    .trim();
}
const base = p => (p ? path.basename(String(p)) : '');

function descrever(ferramenta, e) {
  const i = e || {};
  switch (ferramenta) {
    case 'Read': return 'lendo ' + base(i.file_path);
    case 'Edit': case 'MultiEdit': return 'editando ' + base(i.file_path);
    case 'Write': return 'escrevendo ' + base(i.file_path);
    case 'NotebookEdit': return 'editando ' + base(i.notebook_path);
    case 'Bash': return 'terminal: ' + curto(censurar(i.command), 44);
    case 'Grep': return 'buscando "' + curto(censurar(i.pattern), 22) + '"';
    case 'Glob': return 'procurando arquivos';
    case 'WebFetch': case 'WebSearch': return 'pesquisando na web';
    case 'Task': case 'Agent': return 'chamou ' + (i.subagent_type || 'um agente');
    case 'TodoWrite': return 'organizando tarefas';
    case 'Skill': return 'usando skill ' + curto(String(i.skill || ''), 24);
    case 'AskUserQuestion': return 'tem uma pergunta para você';
    default:
      if (String(ferramenta).startsWith('mcp__')) return 'usando ' + curto(String(ferramenta).split('__')[1] || 'conector', 24);
      return 'usando ' + curto(String(ferramenta || 'ferramenta'), 24);
  }
}

function contaDe(ev) {
  const t = String(ev.transcript_path || '');
  for (const [conta, dir] of Object.entries(config.contas || { pessoal: '' })) if (dir && t.startsWith(dir.replace(/\/$/, '') + '/')) return conta;
  return Object.keys(config.contas || { pessoal: '' })[0] || 'pessoal';
}

function obterSessao(ev) {
  const id = String(ev.session_id || '');
  if (!id) return null;
  let s = sessoes.get(id);
  if (!s) {
    s = { id, nome: nomeDe(id), tarefa: null, entrega: null, conta: contaDe(ev), estado: 'ocioso', acao: '', pedido: '', modelo: '',
      cwd: '', setor: 'recepcao', subagentes: [], inicio: Date.now(), ultimoEvento: Date.now(), desdeEstado: Date.now(), tarefasFeitas: 0,
      resultado: null, ordem: null, especialidade: 'generalista', pontosPapel: {}, papelFixo: false };
    atualizarNivel(s);
    sessoes.set(id, s);
  }
  if (ev.__ordem && ordens.has(ev.__ordem)) {
    s.ordem = ev.__ordem;
    const papel = ordens.get(ev.__ordem).papel;
    if (papel) { s.especialidade = papel; s.papelFixo = true; }
  }
  if (ev.__maquina) s.maquina = ev.__maquina;
  if (historicoValido(ev.transcript_path)) s.transcript = ev.transcript_path;
  if (ev.cwd) { s.cwd = ev.cwd; s.setor = setorDaPasta(ev.cwd, s.maquina); }
  s.ultimoEvento = Date.now();
  s.travado = false;
  return s;
}

// subagente que termina não vai embora: fica de folga no escritório (até 8 por agente)
function encerrarSub(s, a) {
  if (!a || !a.ativo) return;
  a.ativo = false;
  a.fim = Date.now();
  const folga = s.subagentes.filter(x => !x.ativo);
  if (folga.length > 8) s.subagentes.splice(s.subagentes.indexOf(folga[0]), 1);
}

function mudarEstado(s, estado) {
  if (s.estado !== estado) {
    s.estado = estado; s.desdeEstado = Date.now();
    if (estado === 'esperando') notificar('esperando', `${s.nome} (${nomeSetor(s.setor)}) está esperando você${s.acao ? ': ' + s.acao : ''}.`);
  }
}
const nomeSetor = id => listaSetores().find(x => x.id === id)?.nome || 'Recepção';

// ---------- Telegram: avisos no celular ----------
const ARQ_TELEGRAM = path.join(DADOS, 'telegram.json');
let telegram = null;
try { telegram = JSON.parse(fs.readFileSync(ARQ_TELEGRAM, 'utf8')); } catch { telegram = null; }
const EVENTOS_AVISO = ['entrega', 'esperando', 'travado', 'falha', 'agenda', 'conquista'];
async function enviarTelegram(texto, cfg = telegram) {
  if (!cfg?.token || !cfg?.chatId) return { erro: 'Telegram não configurado.' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ chat_id: cfg.chatId, text: texto.slice(0, 3900), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { erro: j.description || 'O Telegram recusou a mensagem.' };
  } catch { return { erro: 'Não consegui falar com o Telegram.' }; }
}
function notificar(evento, texto) {
  if (!telegram?.token || telegram.eventos?.[evento] === false) return;
  const link = config.enderecoPublico ? `\n${config.enderecoPublico}` : '';
  enviarTelegram(`Escritório: ${texto}${link}`).then(r => r.erro && console.error('telegram:', r.erro));
}
async function configurarTelegram({ token, eventos, desligar }) {
  if (desligar) { telegram = null; fs.rmSync(ARQ_TELEGRAM, { force: true }); return { ok: true }; }
  token = String(token || telegram?.token || '').trim();
  if (!/^\d{5,}:[\w-]{20,}$/.test(token)) return { erro: 'Esse token não parece de bot do Telegram (formato 123456:ABC...).' };
  let chatId = telegram?.token === token ? telegram.chatId : null;
  if (!chatId) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (!j.ok) return { erro: 'Token recusado pelo Telegram.' };
      chatId = [...(j.result || [])].reverse().map(u => (u.message || u.edited_message || u.channel_post)?.chat?.id).find(Boolean);
    } catch { return { erro: 'Não consegui falar com o Telegram.' }; }
    if (!chatId) return { erro: 'Mande um "oi" para o seu bot no Telegram e clique em salvar de novo.' };
  }
  const cfg = { token, chatId, eventos: Object.fromEntries(EVENTOS_AVISO.map(e => [e, eventos?.[e] !== false])) };
  const t = await enviarTelegram('Escritório conectado. Você vai receber os avisos por aqui.', cfg);
  if (t.erro) return t;
  telegram = cfg;
  fs.writeFileSync(ARQ_TELEGRAM, JSON.stringify(cfg), { mode: 0o600 });
  return { ok: true };
}

function processar(ev) {
  const tipo = ev.hook_event_name;
  const s = obterSessao(ev);
  if (!s) return;
  switch (tipo) {
    case 'SessionStart':
      if (ev.model) s.modelo = typeof ev.model === 'string' ? ev.model : (ev.model.display_name || ev.model.id || '');
      if (s.estado === 'saiu') mudarEstado(s, 'ocioso');
      break;
    case 'UserPromptSubmit':
      s.pedido = curto(censurar(ev.prompt), 160);
      s.passos = []; s.falas = []; s.inicioTurno = Date.now();
      {
        const t = { pedido: String(ev.prompt || ''), inicio: Date.now(), arquivos: [], comandos: 0, ferramentas: 0, desde: 0 };
        s.tarefa = t;
        tamanhoHistorico(ev.transcript_path).then(n => { t.desde = n; });
      }
      s.acao = 'pensando…';
      mudarEstado(s, 'trabalhando');
      break;
    case 'PreToolUse': {
      s.acao = descrever(ev.tool_name, ev.tool_input);
      (s.passos ||= []).push({ t: Date.now(), acao: s.acao });
      if (s.passos.length > 40) s.passos.shift();
      {
        const i = ev.tool_input || {};
        const arqP = i.file_path || i.notebook_path || i.path;
        const peso = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(ev.tool_name) ? 3 : 1;
        pontuarPapel(s, papelDoArquivo(arqP), peso);
        if (ev.tool_name === 'Bash') pontuarPapel(s, papelDoComando(i.command), 2);
      }
      if (s.tarefa) {
        const t = s.tarefa, i = ev.tool_input || {};
        t.ferramentas++;
        if (ev.tool_name === 'Bash') t.comandos++;
        const arq = ['Edit', 'MultiEdit', 'Write'].includes(ev.tool_name) ? i.file_path : ev.tool_name === 'NotebookEdit' ? i.notebook_path : null;
        if (arq) {
          const rel = s.cwd && String(arq).startsWith(s.cwd + '/') ? path.relative(s.cwd, arq) : String(arq);
          if (!t.arquivos.includes(rel)) t.arquivos.push(rel);
        }
      }
      if (ev.tool_name === 'ExitPlanMode' && ev.tool_input?.plan) {
        plano = { texto: censurarTexto(String(ev.tool_input.plan)).slice(0, 4000), agente: s.nome, setor: s.setor, em: Date.now() };
      }
      if (ev.tool_name === 'AskUserQuestion' || ev.tool_name === 'ExitPlanMode') mudarEstado(s, 'esperando');
      else mudarEstado(s, 'trabalhando');
      if (ev.tool_name === 'Task' || ev.tool_name === 'Agent') {
        const i = ev.tool_input || {};
        const novo = { id: ev.tool_use_id || crypto.randomUUID(), ativo: true, tipo: i.subagent_type || 'agente',
          descricao: curto(censurar(i.description), 60), segundoPlano: i.run_in_background !== false, inicio: Date.now() };
        const k = s.subagentes.findIndex(x => x.id === novo.id);
        if (k >= 0) s.subagentes[k] = novo; else s.subagentes.push(novo);
      }
      break;
    }
    case 'PostToolUse':
      if ((ev.tool_name === 'Task' || ev.tool_name === 'Agent') && ev.tool_input?.run_in_background === false) {
        encerrarSub(s, s.subagentes.find(a => a.ativo && a.id === ev.tool_use_id));
      }
      if (ev.tool_name === 'Bash') {
        const r = resultadoDe(ev);
        if (r) {
          s.resultado = r;
          if (!r.ok) notificar('falha', `${r.tipo === 'deploy' ? 'Deploy falhou' : 'Testes falharam'} em ${nomeSetor(s.setor)} (${s.nome}): ${r.comando}`);
          if (r.ok) verificarConquistas(s, r);
          resultadosHoje.push(r);
          if (resultadosHoje.length > 500) resultadosHoje.shift();
        }
      }
      if (s.estado === 'esperando') mudarEstado(s, 'trabalhando');
      break;
    case 'SubagentStop': {
      const t = ev.agent_type;
      encerrarSub(s, (t && s.subagentes.find(a => a.ativo && a.tipo === t)) || s.subagentes.find(a => a.ativo));
      break;
    }
    case 'Notification': {
      const msg = String(ev.message || '');
      const tipoN = String(ev.notification_type || '');
      if (tipoN === 'permission_prompt' || /permission|permiss/i.test(msg)) {
        mudarEstado(s, 'esperando');
        s.acao = curto(censurar(msg.replace(/^Claude needs your permission to use /i, 'quer usar ')), 60) || 'precisa da sua aprovação';
      }
      break;
    }
    case 'Stop':
      if (s.estado === 'trabalhando' || s.estado === 'esperando') {
        s.tarefasFeitas++;
        criarRelatorio(s, ev).catch(e => console.error('relatório:', e.message));
      }
      s.acao = '';
      mudarEstado(s, 'ocioso');
      break;
    case 'SessionEnd':
      // a sessão acabou, mas o robô continua no escritório, de folga
      s.subagentes.forEach(a => encerrarSub(s, a));
      s.encerrada = true;
      s.acao = '';
      mudarEstado(s, 'ocioso');
      break;
  }
}

function reprocessarSetores() {
  for (const s of sessoes.values()) s.setor = setorDaPasta(s.cwd, s.maquina);
}

setInterval(() => {
  const agora = Date.now();
  let mudou = false;
  for (const [id, s] of sessoes) {
    const parado = agora - s.ultimoEvento;
    if (s.estado === 'saiu' && agora - s.desdeEstado > 60_000) { sessoes.delete(id); mudou = true; continue; }
    if (s.estado !== 'ocioso' && s.encerrada) s.encerrada = false;
    if (s.estado === 'ocioso' && config.minutosAteIrEmbora > 0 && parado > config.minutosAteIrEmbora * 60_000) { mudarEstado(s, 'saiu'); mudou = true; }
    const travou = s.estado === 'trabalhando' && parado > config.minutosAteTravado * 60_000;
    if (travou !== !!s.travado) {
      s.travado = travou; mudou = true;
      if (travou) notificar('travado', `${s.nome} (${nomeSetor(s.setor)}) parece travado: sem novidade há ${config.minutosAteTravado} min${s.acao ? ' (' + s.acao + ')' : ''}.`);
    }
    for (const a of s.subagentes) if (a.ativo && agora - a.inicio > 60 * 60_000) { encerrarSub(s, a); mudou = true; }
  }
  // escritório não lota: passando do limite, quem está de folga há mais tempo vai para casa
  const deFolga = [...sessoes.values()].filter(s => s.estado === 'ocioso').sort((a, b) => a.ultimoEvento - b.ultimoEvento);
  for (const s of deFolga.slice(0, Math.max(0, deFolga.length - (config.maxDeFolga ?? 20)))) { mudarEstado(s, 'saiu'); mudou = true; }
  if (mudou) avisar();
}, 15_000);

// o time fica salvo em disco: se o serviço reiniciar, os robôs continuam no escritório
const ARQ_SESSOES = path.join(DADOS, 'sessoes.json');
let gravacaoSessoes = null;
function gravarSessoes() {
  if (gravacaoSessoes) return;
  gravacaoSessoes = setTimeout(() => {
    gravacaoSessoes = null;
    const lista = [...sessoes.values()].filter(s => s.estado !== 'saiu');
    fs.writeFile(ARQ_SESSOES + '.tmp', JSON.stringify(lista), { mode: 0o600 }, e => { if (!e) fs.rename(ARQ_SESSOES + '.tmp', ARQ_SESSOES, () => {}); });
  }, 5000);
}
try {
  const agora = Date.now();
  for (const s of JSON.parse(fs.readFileSync(ARQ_SESSOES, 'utf8'))) {
    if (config.minutosAteIrEmbora > 0 && agora - s.ultimoEvento > config.minutosAteIrEmbora * 60_000) continue;
    (s.subagentes ||= []).forEach(a => { a.ativo = false; });
    s.travado = false;
    if (s.estado !== 'ocioso' && agora - s.ultimoEvento > 15 * 60_000) { s.estado = 'ocioso'; s.acao = ''; }
    s.pontosPapel ||= {};
    s.setor = setorDaPasta(s.cwd, s.maquina);
    sessoes.set(s.id, s);
  }
  console.log(`${sessoes.size} agentes voltaram ao escritório`);
} catch { /* primeira vez: ainda não tem time salvo */ }

// ---------- ideias: lista de coisas para fazer depois, que viram tarefa com um clique ----------
const ARQ_IDEIAS = path.join(DADOS, 'ideias.json');
let ideias = [];
try { ideias = JSON.parse(fs.readFileSync(ARQ_IDEIAS, 'utf8')); } catch { ideias = []; }
const gravarIdeias = () => gravarJSON(ARQ_IDEIAS, ideias.slice(0, 300));
const PRIORIDADES = ['alta', 'media', 'baixa'];
function salvarIdeia(d) {
  const titulo = String(d.titulo || '').trim().slice(0, 200), detalhe = String(d.detalhe || '').trim().slice(0, 4000);
  if (titulo.length < 3) return { erro: 'Escreva a ideia (pelo menos 3 letras).' };
  const setor = listaSetores().some(x => x.id === d.setor) ? d.setor : 'geral';
  const prioridade = PRIORIDADES.includes(d.prioridade) ? d.prioridade : 'media';
  const papel = d.papel && (config.especialidades || []).some(e => e.id === d.papel) ? d.papel : '';
  const i = { id: crypto.randomBytes(6).toString('hex'), titulo, detalhe, setor, prioridade, papel, status: 'ideia', criada: Date.now() };
  ideias.unshift(i); gravarIdeias(); avisar();
  return { ok: true, id: i.id };
}
async function acaoIdeia(id, acao, d, ip) {
  const i = ideias.find(x => x.id === id);
  if (!i) return { erro: 'Ideia não encontrada.' };
  if (acao === 'apagar') { ideias = ideias.filter(x => x !== i); gravarIdeias(); avisar(); return { ok: true }; }
  if (acao === 'mover') {
    if (['ideia', 'planejada'].includes(d.status)) i.status = d.status;
    if (PRIORIDADES.includes(d.prioridade)) i.prioridade = d.prioridade;
    gravarIdeias(); avisar(); return { ok: true };
  }
  if (acao === 'mandar') {
    if (i.status === 'mandada') return { erro: 'Essa ideia já foi mandada.' };
    const conta = ['pessoal', 'empresa'].includes(d.conta) ? d.conta : 'pessoal';
    const r = await novaOrdem({ setor: i.setor, pedido: i.detalhe ? `${i.titulo}\n\n${i.detalhe}` : i.titulo, conta, papel: i.papel || undefined, modo: d.modo === 'conversa' ? 'conversa' : 'executar' }, ip, 'ideia');
    if (r.erro) return r;
    i.status = 'mandada'; i.ordem = r.id; i.mandada = Date.now(); gravarIdeias(); avisar();
    return { ok: true, ordem: r.id };
  }
  return { erro: 'Ação inválida.' };
}

// ---------- histórico de publicações de todos os sistemas ----------
// fontes: Coolify, pacotes dos apps (Play Store), registros de publicação (publicar.sh),
// trocas de versão dos containers que o escritório percebe e as publicações feitas pelo próprio escritório
const ARQ_VERSOES = path.join(DADOS, 'versoes.json');
let versoes = { atuais: {}, eventos: [] };
try { versoes = { atuais: {}, eventos: [], ...JSON.parse(fs.readFileSync(ARQ_VERSOES, 'utf8')) }; } catch { /* começa agora */ }
const ehCoolify = nome => /^[a-z0-9]{24}(-\d+)?$/.test(nome);
async function acompanharVersoes() {
  const ids = await rodar('docker', ['ps', '-q'], null, 20_000);
  const lista = ids.saida.split('\n').filter(Boolean);
  if (!lista.length) return;
  const r = await rodar('docker', ['inspect', '--format', '{{.Name}}|{{.Image}}|{{.Config.Image}}|{{.Created}}', ...lista], null, 30_000);
  const primeira = !Object.keys(versoes.atuais).length;
  for (const l of r.saida.split('\n').filter(Boolean)) {
    const [n, imagemId, imagem, criado] = l.split('|'), nome = n.replace(/^\//, '');
    if (ehCoolify(nome) || /buildkit/.test(nome)) continue;
    const antes = versoes.atuais[nome];
    if (antes && antes.id !== imagemId) {
      const g = grupoDoContainer(nome);
      versoes.eventos.unshift({ t: Date.parse(criado) || Date.now(), container: nome, imagem, grupo: g.nome, setor: g.setor || null, id: imagemId.slice(7, 19), antes: antes.id.slice(7, 19) });
    }
    if (!antes || antes.id !== imagemId) versoes.atuais[nome] = { id: imagemId, imagem, desde: Date.parse(criado) || Date.now() };
  }
  versoes.eventos = versoes.eventos.slice(0, 500);
  if (primeira) console.log('versões: começou a acompanhar', Object.keys(versoes.atuais).length, 'containers');
  gravarJSON(ARQ_VERSOES, versoes);
}
const acompanharVersoesR = rotina('versoes', acompanharVersoes);
setInterval(acompanharVersoesR, 10 * 60_000);
setTimeout(acompanharVersoesR, 60_000);

function setorPorNome(texto) {
  const t = String(texto || '').toLowerCase();
  const mapa = config.historico?.setores || {};
  for (const [padrao, setor] of Object.entries(mapa)) if (new RegExp(padrao, 'i').test(t)) return setor;
  return listaSetores().find(x => x.id !== 'geral' && t.includes(x.id.toLowerCase()))?.id || null;
}
let cacheHistorico = { em: 0, itens: [] };
async function historicoPublicacoes() {
  if (Date.now() - cacheHistorico.em < 60_000) return cacheHistorico.itens;
  const itens = [];
  // 1. Coolify
  const sql = `select coalesce(a.name, q.application_name), q.status, coalesce(q.commit, ''), left(translate(coalesce(q.commit_message, ''), chr(10) || chr(13) || chr(9), '   '), 300), (extract(epoch from q.created_at) * 1000)::bigint,
    (extract(epoch from coalesce(q.finished_at, q.updated_at)) * 1000)::bigint, q.rollback, q.restart_only from application_deployment_queues q left join applications a on a.id = q.application_id::bigint
    where q.created_at > now() - interval '120 days' order by q.created_at desc limit 400`;
  const c = await rodar('docker', ['exec', 'coolify-db', 'sh', '-c', `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F '\t' -c '${sql.replace(/'/g, "'\\''")}'`], null, 30_000);
  if (!c.erro) for (const l of c.saida.split('\n').filter(Boolean)) {
    const [app, status, commit, msg, criado, fim, rollback, restart] = l.split('\t');
    if (!app || !status || status === 'queued' || commit === undefined) continue;
    itens.push({ fonte: 'coolify', app, setor: setorPorNome(app), ambiente: /homolog|staging/.test(app) ? 'homologação' : /produc|prod/.test(app) ? 'produção' : '',
      versao: commit.slice(0, 8), commit, mensagem: censurarTexto(msg.replace(/\s*Co-Authored-By:.*$/is, '').split(/\s{2,}/)[0]).slice(0, 160), t: Number(criado), fim: Number(fim) || null,
      status: status === 'finished' ? 'ok' : status === 'failed' ? 'falhou' : status === 'in_progress' ? 'publicando' : status === 'cancelled-by-user' ? 'cancelado' : status,
      tipo: rollback === 't' ? 'volta' : restart === 't' ? 'reinicio' : 'publicacao', quem: 'Coolify' });
  }
  // 2. pacotes dos apps (loja)
  for (const pasta of config.historico?.lojas || []) {
    let arqs = [];
    try {
      for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
        if (e.isFile()) arqs.push(path.join(pasta, e.name));
        else if (e.isDirectory()) for (const f of fs.readdirSync(path.join(pasta, e.name))) arqs.push(path.join(pasta, e.name, f));
      }
    } catch { continue; }
    for (const arq of arqs.filter(a => /\.(aab|apk|ipa)$/i.test(a))) {
      const nome = path.basename(arq), m = nome.match(/^(.*?)-(\d+\.\d+\.\d+)(?:-(\d+))?\.(aab|apk|ipa)$/i);
      let st; try { st = fs.statSync(arq); } catch { continue; }
      const sub = path.dirname(arq) !== pasta ? path.basename(path.dirname(arq)) : '';
      const app = (m ? m[1] : nome.replace(/\.(aab|apk|ipa)$/i, '')).replace(/-release.*$/, '') + (sub ? ` (${sub})` : '');
      itens.push({ fonte: 'app', app, setor: setorPorNome(app + ' ' + arq), ambiente: /\.ipa$/i.test(nome) ? 'app iOS' : 'app Android', versao: m ? m[2] + (m[3] ? ` (build ${m[3]})` : '') : '',
        mensagem: `Pacote ${nome.split('.').pop().toUpperCase()} para a loja gerado (${Math.round(st.size / 1048576)} MB). O envio para a loja é feito à parte.`, t: st.mtimeMs, status: 'ok', tipo: 'pacote', quem: 'build do app', arquivo: nome });
    }
  }
  // 3. registros de publicação (ex.: um publicar.sh que anota cada publicação)
  for (const reg of config.historico?.registros || []) {
    let txt = ''; try { txt = fs.readFileSync(reg.arquivo, 'utf8'); } catch { continue; }
    for (const l of txt.split('\n').filter(Boolean).slice(-300)) {
      try { const j = JSON.parse(l); itens.push({ fonte: 'registro', app: `${reg.nome} · ${j.app}`, setor: reg.setor, ambiente: 'produção', versao: String(j.commit || '').slice(0, 8), commit: j.commit,
        mensagem: censurarTexto(String(j.mensagem || '')).slice(0, 160), t: Number(j.t), status: j.ok === false ? 'falhou' : 'ok', tipo: 'publicacao', quem: 'publicar.sh', servico: j.app }); } catch { /* linha ruim */ }
    }
  }
  // 4. trocas de versão dos containers
  for (const e of versoes.eventos) itens.push({ fonte: 'container', app: e.container, setor: e.setor, ambiente: '', versao: e.id, mensagem: `Nova versão de ${e.imagem}`, t: e.t, status: 'ok', tipo: 'publicacao', quem: 'percebido pelo escritório' });
  // 5. publicações pelo escritório
  for (const d of deploys) if (['publicado', 'publicando'].includes(d.status))
    itens.push({ fonte: 'escritorio', app: nomeSetor(d.setor), setor: d.setor, ambiente: 'produção', versao: '', mensagem: curto(semQuebra(d.resumo), 160), t: d.aprovado || d.criado, status: d.status === 'publicado' ? 'ok' : 'publicando', tipo: d.volta ? 'volta' : 'publicacao', quem: `${d.agente} (botão Publicar)` });
  itens.sort((a, b) => b.t - a.t);
  // marca a versão que está no ar e quais dá para voltar
  const vistos = new Set();
  for (const it of itens) {
    const k = it.fonte + '|' + it.app;
    if (it.status !== 'ok' || ['pacote', 'reinicio'].includes(it.tipo)) continue;
    if (!vistos.has(k)) { it.atual = true; vistos.add(k); }
    else if (['coolify', 'registro'].includes(it.fonte) && it.commit) it.podeVoltar = true;
  }
  itens.forEach((it, i) => { it.id = crypto.createHash('sha1').update(`${it.fonte}|${it.app}|${it.t}|${it.versao}`).digest('hex').slice(0, 12); });
  cacheHistorico = { em: Date.now(), itens: itens.slice(0, 600) };
  return cacheHistorico.itens;
}
// "voltar versão": vira um pedido de publicação que só sai quando a dona aperta Publicar
async function pedirVolta(id) {
  const it = (await historicoPublicacoes()).find(x => x.id === id);
  if (!it || !it.podeVoltar) return { erro: 'Essa versão não pode ser restaurada por aqui.' };
  if (deploys.some(d => d.volta === id && d.status === 'aguardando')) return { erro: 'Já existe um pedido para voltar a essa versão esperando você.' };
  const quando = new Date(it.t).toLocaleString('pt-BR', { timeZone: FUSO(), dateStyle: 'short', timeStyle: 'short' });
  const comando = it.fonte === 'coolify'
    ? `No Coolify, refazer o deploy da aplicação "${it.app}" no commit ${it.commit} (o que estava no ar em ${quando}). Usar a função de rollback/redeploy do próprio Coolify; não mexer em banco nem em outras aplicações.`
    : `Voltar "${it.app}" para o commit ${it.commit} (publicado em ${quando}) seguindo o LEIA-ME da pasta infra do projeto (imagem :anterior ou checkout do commit + publicar.sh).`;
  const dep = { id: crypto.randomBytes(6).toString('hex'), ordem: null, sessao: null, agente: 'Você', setor: it.setor || 'geral', cwd: pastaDoSetor(it.setor) || '', conta: 'empresa',
    comando: censurarTexto(comando), resumo: `Voltar ${it.app}${it.ambiente ? ' (' + it.ambiente + ')' : ''} para a versão ${it.versao} de ${quando}: ${it.mensagem || 'sem mensagem'}`,
    verificar: 'Conferir que a aplicação subiu na versão pedida e que a tela principal e a API respondem.', status: 'aguardando', criado: Date.now(), volta: id };
  deploys.unshift(dep); gravarDeploys(); avisar();
  return { ok: true, id: dep.id };
}

// ---------- metas por projeto: objetivo com prazo e passos que viram tarefa ----------
const ARQ_METAS = path.join(DADOS, 'metas.json');
let metas = [];
try { metas = JSON.parse(fs.readFileSync(ARQ_METAS, 'utf8')); } catch { metas = []; }
const gravarMetas = () => gravarJSON(ARQ_METAS, metas.slice(0, 100));
const novoId = () => crypto.randomBytes(6).toString('hex');
function criarMeta(d) {
  const titulo = String(d.titulo || '').trim().slice(0, 160);
  if (titulo.length < 3) return { erro: 'Escreva a meta.' };
  const prazo = /^\d{4}-\d{2}-\d{2}$/.test(d.prazo || '') ? d.prazo : null;
  const setor = listaSetores().some(x => x.id === d.setor) ? d.setor : 'geral';
  const passos = String(d.passos || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30).map(texto => ({ id: novoId(), texto: texto.slice(0, 300), status: 'aberto' }));
  const m = { id: novoId(), setor, titulo, prazo, passos, status: 'ativa', criada: Date.now() };
  metas.unshift(m); gravarMetas(); avisar();
  return { ok: true, id: m.id };
}
async function acaoMeta(id, acao, d, ip) {
  const m = metas.find(x => x.id === id);
  if (!m) return { erro: 'Meta não encontrada.' };
  if (acao === 'apagar') { metas = metas.filter(x => x !== m); }
  else if (acao === 'concluir') { m.status = m.status === 'concluida' ? 'ativa' : 'concluida'; m.concluida = Date.now(); }
  else if (acao === 'passo') {
    const texto = String(d.texto || '').trim().slice(0, 300);
    if (!texto) return { erro: 'Escreva o passo.' };
    m.passos.push({ id: novoId(), texto, status: 'aberto' });
  } else {
    const ps = m.passos.find(x => x.id === d.passo);
    if (!ps) return { erro: 'Passo não encontrado.' };
    if (acao === 'marcar') { ps.status = ps.status === 'feito' ? 'aberto' : 'feito'; ps.feito = Date.now(); }
    else if (acao === 'tirar') m.passos = m.passos.filter(x => x !== ps);
    else if (acao === 'mandar') {
      if (ps.status !== 'aberto') return { erro: 'Esse passo já foi mandado ou feito.' };
      const conta = ['pessoal', 'empresa'].includes(d.conta) ? d.conta : 'pessoal';
      const r = await novaOrdem({ setor: m.setor, pedido: `${ps.texto}\n\n(Passo da meta "${m.titulo}"${m.prazo ? `, prazo ${m.prazo.split('-').reverse().join('/')}` : ''}.)`, conta, modo: 'executar' }, ip, 'meta');
      if (r.erro) return r;
      ps.status = 'fazendo'; ps.ordem = r.id; ps.mandado = Date.now();
    } else return { erro: 'Ação inválida.' };
  }
  gravarMetas(); avisar();
  return { ok: true };
}

// ---------- resumo da manhã: ontem, o que espera você, saúde e o plano do dia ----------
async function resumoDaManha(origem = 'agenda') {
  const agora = Date.now(), ontem = diaDe(agora - 864e5), hoje = diaDe(agora);
  const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO(), weekday: 'long', day: '2-digit', month: '2-digit' }).format(agora);
  const rels = relatorios.filter(r => !r.rotina && !r.emRevisao && diaDe(r.fim) === ontem);
  const porSetor = {};
  for (const r of rels) { const p = (porSetor[nomeSetor(r.setor)] ||= { n: 0, quem: new Set() }); p.n++; p.quem.add(r.agente); }
  const pubs = (await historicoPublicacoes().catch(() => [])).filter(i => diaDe(i.t) === ontem && i.status === 'ok' && i.ambiente === 'produção');
  const incOntem = incidentes.filter(i => diaDe(i.desde) === ontem), incAbertos = incidentes.filter(i => i.status === 'aberto');
  const esperando = [
    ...[...sessoes.values()].filter(x => x.estado === 'esperando').map(x => `${x.nome} (${nomeSetor(x.setor)}) quer falar com você`),
    ...deploys.filter(d => d.status === 'aguardando').map(d => `Publicação esperando o botão Publicar: ${curto(semQuebra(d.resumo), 90)}`),
    ...previas.filter(v => v.status === 'ativa').map(v => `Prévia para você ver: ${curto(v.descricao, 80)}`),
    ...projetos.filter(p => p.status === 'aguardando').map(p => `Plano do gerente para aprovar: ${p.titulo}`),
    ...aprendizado.propostas.filter(x => x.status === 'aguardando').map(x => `${x.nome} quer melhorar o próprio manual`),
  ];
  const racksRuins = servidores.filter(g => g.saude !== 'ok' && g.tipo !== 'dev');
  const waRuins = whatsapp.problemas.map(p => p.titulo);
  const plano = [];
  const rc = config.rotinas || {}, { dia } = agoraNoFuso();
  if (rc.devops?.ativo !== false) plano.push(`${rc.devops?.hora || '07:00'} ronda da produção (DevOps)`);
  if (rc.poSemanal?.ativo !== false && dia === (rc.poSemanal?.dia ?? 1)) plano.push(`${rc.poSemanal?.hora || '08:00'} resumo semanal dos POs`);
  if (rc.aprendizado?.ativo && dia === rc.aprendizado.dia) plano.push(`${rc.aprendizado.hora || '17:00'} revisão dos manuais da equipe`);
  for (const a of agenda) {
    if (a.ativo === false) continue;
    const vale = a.repetir === 'uma-vez' ? a.data === hoje : a.repetir === 'diario' || (a.dias || []).includes(dia);
    if (vale) plano.push(`${a.hora} tarefa agendada em ${nomeSetor(a.setor)}: ${curto(semQuebra(a.pedido), 80)}`);
  }
  for (const m of metas.filter(x => x.status === 'ativa' && x.prazo)) {
    const dias = Math.round((Date.parse(m.prazo + 'T12:00:00') - agora) / 864e5), feitos = m.passos.filter(p => p.status === 'feito').length;
    if (dias <= 7) plano.push(`Meta "${m.titulo}" (${nomeSetor(m.setor)}) vence ${dias < 0 ? `há ${-dias} dia(s)` : dias === 0 ? 'hoje' : `em ${dias} dia(s)`}: ${feitos}/${m.passos.length} passos feitos`);
  }
  for (const i of ideias.filter(x => x.status === 'planejada' && x.prioridade === 'alta').slice(0, 5)) plano.push(`Ideia planejada de prioridade alta: ${i.titulo}`);
  const saudeTxt = incAbertos.length ? `${incAbertos.length} incidente(s) aberto(s): ${incAbertos.map(i => i.titulo).join('; ')}`
    : racksRuins.length ? `Atenção em ${racksRuins.map(g => g.nome).join(', ')}` : 'Todos os sistemas no ar';
  const feito = [
    ...Object.entries(porSetor).sort((a, b) => b[1].n - a[1].n).map(([nome, p]) => `${nome}: ${p.n} entrega(s) (${[...p.quem].slice(0, 4).join(', ')})`),
    ...pubs.slice(0, 6).map(i => `Publicado em produção: ${i.app} ${i.versao} (${curto(i.mensagem, 70)})`),
    ...incOntem.map(i => `Incidente ontem: ${i.titulo}${i.status === 'resolvido' ? ' (resolvido)' : ''}`),
  ];
  const simples = {
    titulo: `Bom dia! Resumo de ${fmtData}`,
    resumo: `Ontem a equipe fez ${rels.length} entrega(s)${Object.keys(porSetor).length ? ` em ${Object.keys(porSetor).length} projeto(s)` : ''}${pubs.length ? ` e ${pubs.length} publicação(ões) em produção` : ''}. ${esperando.length ? `${esperando.length} coisa(s) esperam você.` : 'Nada esperando você.'} ${saudeTxt}.`,
    feito: feito.length ? feito : ['Ontem não teve entregas.'],
    resultado: { status: incAbertos.length ? 'problema' : esperando.length || racksRuins.length || waRuins.length ? 'atencao' : 'ok',
      texto: esperando.length ? 'Esperando você: ' + esperando.slice(0, 6).join(' · ') : 'Nada esperando você. Bom dia tranquilo.' },
    proximos: plano.length ? plano : ['Nada programado para hoje. Use o Painel para anotar ideias ou definir metas.'],
    termos: [], pergunta: '', bloqueio: '' };
  if (waRuins.length) simples.feito.push(...waRuins.map(t => `WhatsApp: ${t}`));
  const resposta = `## ${simples.titulo}\n\n${simples.resumo}\n\n### Ontem\n${simples.feito.map(x => '- ' + x).join('\n')}\n\n### Esperando você\n${esperando.length ? esperando.map(x => '- ' + x).join('\n') : '- nada'}\n\n### Saúde\n- ${saudeTxt}${waRuins.length ? '\n' + waRuins.map(x => '- ' + x).join('\n') : ''}\n\n### Plano de hoje\n${simples.proximos.map(x => '- ' + x).join('\n')}`;
  entregarRotina({ sessao: 'resumo-da-manha', agente: 'Resumo do dia', setor: 'escritorio', especialidade: 'produto', cwd: '/root', conta: 'empresa', pedido: 'Resumo da manhã', resposta, simples });
  estadoRotinas.resumoManha = { ultima: Date.now(), origem }; gravarRotinas();
  notificar('esperando', `${simples.titulo}. ${simples.resumo}${esperando.length ? ' Esperando você: ' + esperando.slice(0, 3).join(' · ') : ''}`);
  return { ok: true };
}
setInterval(() => {
  const { data, hora } = agoraNoFuso(), r = config.rotinas?.resumoManha;
  if (r?.ativo && hora === (r.hora || '08:00') && estadoRotinas.resumoManha?.marca !== data) {
    estadoRotinas.resumoManha = { ...(estadoRotinas.resumoManha || {}), marca: data };
    rotina('resumoManha', resumoDaManha)('agenda');
  }
}, 20_000);

// ---------- reunião: 2 ou 3 especialistas discutem um problema e entregam uma decisão ----------
// Só leitura: eles olham o projeto (Read/Grep/Glob) mas não mexem em nada. As tarefas viram ideias planejadas.
const ARQ_REUNIOES = path.join(DADOS, 'reunioes.json');
let reunioes = [];
try { reunioes = JSON.parse(fs.readFileSync(ARQ_REUNIOES, 'utf8')).map(r => r.status === 'andando' ? { ...r, status: 'interrompida' } : r); } catch { reunioes = []; }
const gravarReunioes = () => gravarJSON(ARQ_REUNIOES, reunioes.slice(0, 40));
async function chamarReuniao(d) {
  const tema = String(d.tema || '').trim().slice(0, 3000);
  if (tema.length < 10) return { erro: 'Descreva o assunto da reunião (pelo menos 10 letras).' };
  const ids = [...new Set(Array.isArray(d.participantes) ? d.participantes : [])].filter(id => lerEspecialista(id)).slice(0, 3);
  if (ids.length < 2) return { erro: 'Escolha 2 ou 3 especialistas.' };
  if (reunioes.some(r => r.status === 'andando')) return { erro: 'Já tem uma reunião acontecendo. Espere ela terminar.' };
  const setor = listaSetores().some(x => x.id === d.setor) ? d.setor : 'geral';
  const pasta = pastaDoSetor(setor) || RAIZ_PROJETOS;
  const conta = ['pessoal', 'empresa'].includes(d.conta) ? d.conta : 'pessoal';
  if (!(await contaLogada(conta))) return { erro: `A conta ${conta} do Claude não está logada pela assinatura na VPS.` };
  const r = { id: novoId(), tema, setor, conta, participantes: ids, falas: [], status: 'andando', fase: 'abrindo', inicio: Date.now() };
  reunioes.unshift(r); gravarReunioes(); avisar();
  conduzirReuniao(r, pasta).catch(e => { r.status = 'erro'; r.erro = String(e.message || e).slice(0, 300); r.fim = Date.now(); gravarReunioes(); avisar(); notificar('falha', `A reunião sobre "${curto(tema, 60)}" não conseguiu terminar.`); });
  return { ok: true, id: r.id };
}
async function conduzirReuniao(r, pasta) {
  const quem = id => { const x = lerEspecialista(id); return { id, nome: x.nome, x }; };
  const pessoas = r.participantes.map(quem);
  const def = p => ({ [p.id]: { description: p.x.descricao || p.nome, prompt: `${contextoEmpresa()}\n\nVocê é ${p.nome} numa reunião da ${EMPRESA()}. Nesta reunião você só lê o projeto (pode abrir arquivos para embasar), não altera nada e não roda comandos.\n\n${p.x.manual}`,
    model: p.x.modelo || 'sonnet', tools: ['Read', 'Grep', 'Glob'] } });
  const falar = async (p, prompt) => {
    const t = await rodarClaudeLeitura(pasta, r.conta, prompt, def(p), p.id, 6 * 60_000);
    return censurarTexto(String(t || '').trim()).slice(0, 2500);
  };
  const nomes = pessoas.map(p => p.nome).join(', ');
  // rodada 1: cada um dá a sua visão (ao mesmo tempo)
  r.fase = 'cada um dá a sua visão'; avisar();
  const r1 = await Promise.all(pessoas.map(p => falar(p, `Reunião sobre o projeto ${nomeSetor(r.setor)} com ${nomes}.\nAssunto trazido pela dona:\n«${r.tema}»\n\nDê a SUA visão como ${p.nome}, em português simples, até 180 palavras: o que você acha, o que propõe e o principal risco na sua área. Se precisar, olhe os arquivos do projeto antes. Não use títulos, escreva como fala numa reunião.`)));
  r1.forEach((t, i) => r.falas.push({ quem: pessoas[i].id, nome: pessoas[i].nome, rodada: 1, texto: t }));
  gravarReunioes(); avisar();
  // rodada 2: cada um responde aos colegas
  r.fase = 'discutindo entre si'; avisar();
  const ata1 = r.falas.map(f => `${f.nome}: ${f.texto}`).join('\n\n');
  const r2 = await Promise.all(pessoas.map(p => falar(p, `Continuação da reunião sobre: "${curto(r.tema, 400)}".\nO que cada um disse:\n\n${ata1}\n\nAgora responda aos colegas como ${p.nome}, até 120 palavras: com o que concorda, do que discorda e o que ajustaria. Seja direto e procure chegar num acordo.`)));
  r2.forEach((t, i) => r.falas.push({ quem: pessoas[i].id, nome: pessoas[i].nome, rodada: 2, texto: t }));
  gravarReunioes(); avisar();
  // decisão
  r.fase = 'fechando a decisão'; avisar();
  const ata = r.falas.map(f => `[rodada ${f.rodada}] ${f.nome}: ${f.texto}`).join('\n\n');
  const papeis = (config.especialidades || []).map(e => e.id).join(', ');
  const txt = await rodarClaudeLeitura(pasta, r.conta, `Você é o gerente de projetos da ${EMPRESA()} e conduziu esta reunião sobre "${r.tema}" (projeto ${nomeSetor(r.setor)}).\nAta:\n\n${ata}\n\nFeche a reunião. Responda APENAS JSON: {"decisao": "a decisão em 2 a 3 frases simples para a dona", "porques": ["motivo", "..."], "tarefas": [{"texto": "tarefa concreta e pequena", "papel": "um destes ids: ${papeis}"}], "riscos": ["risco", "..."], "pergunta": "pergunta para a dona se faltar uma decisão dela, senão vazio"}`,
    { gerente: { description: 'Gerente de projetos', prompt: contextoEmpresa(), model: 'sonnet', tools: ['Read'] } }, 'gerente', 5 * 60_000);
  let j; try { j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { throw new Error('o gerente não devolveu a decisão'); }
  const tarefas = (Array.isArray(j.tarefas) ? j.tarefas : []).slice(0, 8).map(t => ({ texto: censurarTexto(String(t.texto || '')).slice(0, 200), papel: (config.especialidades || []).some(e => e.id === t.papel) ? t.papel : '' })).filter(t => t.texto);
  r.decisao = { texto: censurarTexto(String(j.decisao || '')).slice(0, 1200), porques: (j.porques || []).slice(0, 6).map(x => censurarTexto(String(x)).slice(0, 300)),
    riscos: (j.riscos || []).slice(0, 6).map(x => censurarTexto(String(x)).slice(0, 300)), tarefas, pergunta: censurarTexto(String(j.pergunta || '')).slice(0, 500) };
  // as tarefas viram ideias planejadas, prontas para mandar
  for (const t of tarefas) ideias.unshift({ id: novoId(), titulo: t.texto, detalhe: `Saiu da reunião sobre: ${curto(r.tema, 200)}`, setor: r.setor, prioridade: 'media', papel: t.papel, status: 'planejada', criada: Date.now(), reuniao: r.id });
  gravarIdeias();
  r.status = 'concluida'; r.fase = ''; r.fim = Date.now(); gravarReunioes();
  const nomesCurtos = pessoas.map(p => p.nome).join(', ');
  entregarRotina({ sessao: 'reuniao-' + r.id, agente: 'Reunião', setor: r.setor, especialidade: 'produto', cwd: pasta, conta: r.conta, pedido: `Reunião: ${r.tema}`,
    resposta: `## Reunião: ${curto(r.tema, 120)}\n\nParticipantes: ${nomesCurtos}\n\n### Decisão\n${r.decisao.texto}\n\n### Por quê\n${r.decisao.porques.map(x => '- ' + x).join('\n')}\n\n### Riscos\n${r.decisao.riscos.map(x => '- ' + x).join('\n')}\n\n### Tarefas (viraram ideias planejadas)\n${tarefas.map(t => `- ${t.texto}${t.papel ? ` (${t.papel})` : ''}`).join('\n')}\n\n### Ata\n${r.falas.map(f => `**${f.nome}** (rodada ${f.rodada}): ${f.texto}`).join('\n\n')}`,
    simples: { titulo: `Reunião: ${curto(r.tema, 80)}`, resumo: r.decisao.texto, feito: r.falas.filter(f => f.rodada === 1).map(f => `${f.nome}: ${curto(semQuebra(f.texto), 220)}`),
      resultado: { status: r.decisao.pergunta ? 'atencao' : 'ok', texto: `${tarefas.length} tarefa(s) viraram ideias planejadas no Painel › Planejamento.` },
      proximos: tarefas.map(t => t.texto), termos: [], pergunta: r.decisao.pergunta, bloqueio: '' } });
  avisar();
  notificar('esperando', `A reunião sobre "${curto(r.tema, 60)}" terminou: ${curto(r.decisao.texto, 160)}`);
}

// ---------- convidados: link para um amigo trabalhar em UM projeto ----------
// Permissão por convidado: 'ver' (só acompanha), 'aprovar' (pede e a dona aprova) ou 'direto' (roda na hora).
// O token do link nunca é guardado em texto: só o hash. Toda requisição revalida o convite (cancelar vale na hora).
const ARQ_CONVITES = path.join(DADOS, 'convites.json');
let convites = [];
try { convites = JSON.parse(fs.readFileSync(ARQ_CONVITES, 'utf8')); } catch { convites = []; }
const gravarConvites = () => gravarJSON(ARQ_CONVITES, convites.slice(0, 100));
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const PERMISSOES = ['ver', 'aprovar', 'direto'];
const semAnexos = t => String(t || '').split('\n\nArquivos anexados')[0];
const conviteAtivo = c => c && c.ativo && (!c.expira || c.expira > Date.now());
function criarConvite(d) {
  const nome = String(d.nome || '').trim().slice(0, 60);
  if (nome.length < 2) return { erro: 'Escreva o nome do seu amigo.' };
  if (!listaSetores().some(x => x.id === d.setor) || ['geral', 'escritorio'].includes(d.setor)) return { erro: 'Escolha um projeto.' };
  if (!pastaDoSetor(d.setor)) return { erro: 'Esse projeto não tem pasta.' };
  const permissao = PERMISSOES.includes(d.permissao) ? d.permissao : 'aprovar';
  const conta = Object.keys(config.contas || { pessoal: '' }).includes(d.conta) ? d.conta : Object.keys(config.contas || { pessoal: '' })[0];
  const dias = Number(d.dias);
  const token = crypto.randomBytes(24).toString('base64url');
  const c = { id: novoId(), nome, setor: d.setor, permissao, conta, criado: Date.now(), expira: dias > 0 ? Date.now() + Math.min(dias, 90) * 864e5 : null,
    hash: hashToken(token), ativo: true, ordens: [], pendentes: [] };
  convites.unshift(c); gravarConvites(); avisar();
  return { ok: true, id: c.id, link: linkDoConvite(token) };
}
const linkDoConvite = token => { const h = (config.origensPermitidas || [])[0]; return `${h ? 'https://' + h : ''}/convite/${token}`; };
function acaoConvite(id, acao, d) {
  const c = convites.find(x => x.id === id);
  if (!c) return { erro: 'Convite não encontrado.' };
  if (acao === 'cancelar') { c.ativo = false; c.cancelado = Date.now(); for (const [t, g] of convidadosLogados) if (g.convite === id) convidadosLogados.delete(t); gravarSessoesConvidado(); }
  else if (acao === 'permissao') { if (!PERMISSOES.includes(d.permissao)) return { erro: 'Permissão inválida.' }; c.permissao = d.permissao; }
  else if (acao === 'renovar') { const dias = Number(d.dias) || 7; c.expira = Date.now() + Math.min(dias, 90) * 864e5; c.ativo = true; }
  else if (acao === 'novo-link') { const token = crypto.randomBytes(24).toString('base64url'); c.hash = hashToken(token); for (const [t, g] of convidadosLogados) if (g.convite === id) convidadosLogados.delete(t); gravarSessoesConvidado(); gravarConvites(); avisar(); return { ok: true, link: linkDoConvite(token) }; }
  else if (acao === 'apagar') { convites = convites.filter(x => x !== c); for (const [t, g] of convidadosLogados) if (g.convite === id) convidadosLogados.delete(t); gravarSessoesConvidado(); }
  else return { erro: 'Ação inválida.' };
  gravarConvites(); avisar();
  return { ok: true };
}
// conversas do convidado: só as sessões que nasceram de pedidos dele
function sessoesDoConvidado(c) {
  const ids = new Set();
  for (const r of relatorios) if (r.ordem && c.ordens.includes(r.ordem) && r.sessao) ids.add(r.sessao);
  for (const sx of sessoes.values()) if (sx.ordem && c.ordens.includes(sx.ordem)) ids.add(sx.id);
  return ids;
}
async function pedidoDoConvidado(c, d, ip) {
  if (c.permissao === 'ver') return { erro: 'Seu acesso é só para acompanhar.' };
  const pedido = String(d.pedido || '').trim().slice(0, 6000);
  if (pedido.length < 3) return { erro: 'Escreva o pedido.' };
  const modo = d.modo === 'conversa' ? 'conversa' : 'executar';
  const sessao = d.sessao && sessoesDoConvidado(c).has(d.sessao) ? d.sessao : null;
  if (d.sessao && !sessao) return { erro: 'Essa conversa não é sua.' };
  const abertos = c.ordens.filter(id => { const o = ordens.get(id); return o && (o.ativa || o.naFila); }).length + c.pendentes.filter(x => x.status === 'aguardando').length;
  if (abertos >= 3) return { erro: 'Você já tem 3 pedidos em andamento. Espere algum terminar.' };
  if (c.permissao === 'aprovar') {
    c.pendentes.unshift({ id: novoId(), pedido, modo, sessao, criado: Date.now(), status: 'aguardando' });
    c.pendentes = c.pendentes.slice(0, 50); gravarConvites(); avisar();
    notificar('esperando', `${c.nome} (convidado em ${nomeSetor(c.setor)}) pediu: ${curto(pedido, 140)}. Abra Ajustes → Convidados para aprovar.`);
    return { ok: true, aguardando: true };
  }
  return mandarDoConvidado(c, { pedido, modo, sessao }, ip);
}
async function mandarDoConvidado(c, { pedido, modo, sessao }, ip) {
  const r = await novaOrdem({ setor: c.setor, pedido: `${pedido}\n\n(Pedido de ${c.nome}, convidado neste projeto. Trabalhe só nesta pasta.)`, conta: c.conta, modo, sessao: sessao || undefined }, ip, 'convidado', { convidado: c.id, pedidoVisivel: `${c.nome}: ${curto(pedido, 140)}` });
  if (r.erro) return r;
  c.ordens.push(r.id); c.ordens = c.ordens.slice(-200); gravarConvites(); avisar();
  return { ok: true, ordem: r.id };
}
async function decidirPedidoConvidado(id, pid, aprovar, ip) {
  const c = convites.find(x => x.id === id), pd = c?.pendentes.find(x => x.id === pid);
  if (!pd || pd.status !== 'aguardando') return { erro: 'Esse pedido não está aguardando.' };
  if (!aprovar) { pd.status = 'recusado'; pd.decidido = Date.now(); gravarConvites(); avisar(); return { ok: true }; }
  if (!conviteAtivo(c)) return { erro: 'O convite não está mais ativo.' };
  const r = await mandarDoConvidado(c, pd, ip);
  if (r.erro) return r;
  pd.status = 'aprovado'; pd.decidido = Date.now(); pd.ordem = r.ordem; gravarConvites(); avisar();
  return { ok: true };
}
// tranca: a tarefa de convidado só enxerga a pasta do projeto (o resto do servidor fica invisível)
function trancaDoConvidado(o) {
  const minhas = (setoresComPastas().find(x => x.id === o.setor)?.pastas || [o.pasta]).map(p => path.resolve(p));
  const ehMeuCaminho = p => minhas.some(m => m === p || m.startsWith(p + '/') || p.startsWith(m + '/'));
  const esconder = new Set();
  // pastas de outros projetos
  for (const st of setoresComPastas()) for (const p of st.pastas || []) { const r = path.resolve(p); if (!ehMeuCaminho(r)) esconder.add(r); }
  // e todas as pastas de nível de cima da casa que não são do projeto (ex.: ~/outro-projeto-prod)
  try { for (const e of fs.readdirSync(os.homedir(), { withFileTypes: true })) { const q = path.join(os.homedir(), e.name); if (e.isDirectory() && !e.name.startsWith('.') && !ehMeuCaminho(q)) esconder.add(q); } } catch { /* sem acesso */ }
  // vizinhos no caminho até a pasta do projeto (ex.: os outros projetos dentro da raiz)
  for (const m of minhas) {
    let pai = path.dirname(m), filho = m;
    while (pai.length > 1 && pai !== os.homedir()) {
      try { for (const e of fs.readdirSync(pai)) { const q = path.join(pai, e); if (q !== filho && !ehMeuCaminho(q)) esconder.add(q); } } catch { /* sem acesso */ }
      filho = pai; pai = path.dirname(pai);
    }
  }
  // coisas sensíveis do servidor
  const casa = os.homedir();
  for (const x of ['.ssh', '.config/gh', '.docker', '.git-credentials', '.netrc', '.aws', '.kube', 'backups', 'backup-vps', '.gnupg']) esconder.add(path.join(casa, x));
  // do escritório, o convidado só precisa dos ganchos (e do token deles): esconde config, conversas, senhas e manuais
  esconder.add(path.join(RAIZ, 'config.json')); esconder.add(path.join(RAIZ, 'especialistas')); esconder.add(path.join(RAIZ, '.git'));
  try { for (const f of fs.readdirSync(DADOS)) if (f !== 'hook-token') esconder.add(path.join(DADOS, f)); } catch { /* sem dados */ }
  // conta do Claude: some o histórico e as conversas dos outros projetos, as instruções globais e as skills
  const dirClaude = dirConta(o.conta) || path.join(casa, '.claude');
  for (const x of ['history.jsonl', 'file-history', 'backups', 'plans', 'paste-cache', 'uploads', 'CLAUDE.md', 'skills', 'tasks']) esconder.add(path.join(dirClaude, x));
  const meuProjeto = path.resolve(o.pasta).replace(/[^a-zA-Z0-9]/g, '-');
  try { for (const d of fs.readdirSync(path.join(dirClaude, 'projects'))) if (d !== meuProjeto) esconder.add(path.join(dirClaude, 'projects', d)); } catch { /* sem pasta */ }
  for (const x of [COFRE, config.backupEscritorio, '/var/run/docker.sock', '/run/docker.sock', '/etc/escritorio-agentes.conf', '/data/coolify', ...(config.pastasBackup || [])]) if (x) esconder.add(path.resolve(x));
  // a outra conta do Claude (o convidado só usa a conta escolhida no convite)
  for (const [conta, dir] of Object.entries(config.contas || {})) if (dir && conta !== o.conta) esconder.add(path.resolve(dir));
  for (const m of minhas) for (const x of [...esconder]) if (m === x || m.startsWith(x + '/')) esconder.delete(x);
  // os ganchos do escritório (eventos e a trava de publicação) precisam continuar visíveis
  for (const x of [...esconder]) if (x === RAIZ || RAIZ.startsWith(x + '/') || x === path.join(RAIZ, 'hooks') || x === path.join(DADOS, 'hook-token') || x === DADOS) esconder.delete(x);
  if (process.env.ESCRITORIO_DEBUG_TRANCA) console.log('tranca:', [...esconder].join(' '));
  return ['--property=NoNewPrivileges=yes', '--property=PrivateDevices=yes', '--property=ProtectKernelTunables=yes', '--property=ProtectKernelModules=yes', '--property=ProtectControlGroups=yes',
    // aspas: caminhos com espaço no nome; caminhos com aspas ou quebra de linha são ignorados
    ...[...esconder].filter(x => !/["\n\\]/.test(x)).sort().map(x => `--property=InaccessiblePaths="-${x}"`)];
}
function contextoConvidado(o) {
  const c = convites.find(x => x.id === o.convidado);
  return `# Você trabalha para um convidado\n\nQuem está pedindo é ${c?.nome || 'um convidado'}, convidado para trabalhar SÓ no projeto ${nomeSetor(o.setor)} (pasta ${o.pasta}).\n\n## Regras\n1. Trabalhe só nesta pasta. Não tente ler, listar ou alterar nada fora dela, nem configurações do servidor.\n2. Nunca mostre, copie ou registre segredos (.env, tokens, senhas, chaves).\n3. Publicar em produção é bloqueado; se for preciso, prepare tudo e explique o que falta.\n4. Só faça commit/push se a tarefa pedir. Nunca force push.\n5. Se faltar uma decisão importante, pare e pergunte (até 3 perguntas objetivas).\n\n## Como entregar\nTermine com uma resposta curta em português simples: **O que fiz**, **Como conferi**, **Atenção** (se houver) e **Próximos passos** (se fizer sentido).`;
}
function limparParaConvidado(texto, setor) {
  const termos = [];
  for (const st of setoresComPastas()) if (st.id !== setor && !['geral', 'escritorio'].includes(st.id)) { termos.push(st.id, st.nome); for (const p of st.pastas || []) termos.push(p); }
  termos.push(EMPRESA(), RAIZ_PROJETOS, COFRE);
  const re = new RegExp(termos.filter(t => t && String(t).length >= 3).map(t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  return String(texto || '').split('\n').filter(l => !re.test(l)).join('\n');
}
// sessão do convidado (cookie próprio, separado do login da dona)
// guardadas pelo hash do cookie, para sobreviver a reinícios sem deixar o token em disco
const ARQ_SESSOES_CONVIDADO = path.join(DADOS, 'sessoes-convidado.json');
const convidadosLogados = new Map();
try { for (const [h, g] of Object.entries(JSON.parse(fs.readFileSync(ARQ_SESSOES_CONVIDADO, 'utf8')))) if (g.exp > Date.now()) convidadosLogados.set(h, g); } catch { /* nenhuma */ }
const gravarSessoesConvidado = () => gravarJSON(ARQ_SESSOES_CONVIDADO, Object.fromEntries(convidadosLogados));
function convidadoDe(req) {
  const bruto = lerCookie(req, 'escritorio_convidado'), t = bruto && hashToken(bruto);
  const g = t && convidadosLogados.get(t);
  if (!g) return null;
  const c = convites.find(x => x.id === g.convite);
  if (!conviteAtivo(c) || g.exp < Date.now()) { convidadosLogados.delete(t); gravarSessoesConvidado(); return null; }
  return c;
}
function estadoDoConvidado(c) {
  const st = listaSetores().find(x => x.id === c.setor);
  const minhas = sessoesDoConvidado(c);
  const conversas = {};
  for (const r of relatorios.filter(r => r.ordem && c.ordens.includes(r.ordem) && !r.emRevisao).sort((a, b) => a.fim - b.fim)) {
    const k = r.sessao || r.id;
    (conversas[k] ||= []).push({ tipo: 'entrega', t: r.fim, agente: r.agente, pedido: semAnexos(r.pedido || '').replace(/\n\n\(Pedido de .*$/s, '').replace(new RegExp('^' + c.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*'), ''), simples: r.simples || null, resposta: r.simples ? '' : curto(r.resposta || '', 3000), modo: r.modo });
  }
  const andando = c.ordens.map(id => ordens.get(id)).filter(o => o && (o.ativa || o.naFila)).map(o => ({ pedido: (o.pedidoVisivel || o.pedido).replace(/^[^:]+:\s*/, ''), sessao: o.sessao, naFila: o.naFila, ativa: o.ativa, criada: o.criada }));
  return {
    convite: { nome: c.nome, permissao: c.permissao, expira: c.expira, projeto: st?.nome || c.setor, cor: st?.cor || '#888780', empresa: EMPRESA() },
    agentes: [...sessoes.values()].filter(x => x.setor === c.setor && x.estado !== 'saiu').map(x => ({ id: minhas.has(x.id) ? x.id : null, nome: x.nome, estado: x.estado, especialidade: regrasPapel.find(e => e.id === x.especialidade)?.nome || '', acao: minhas.has(x.id) ? curto(x.acao || '', 120) : (x.estado === 'trabalhando' ? 'trabalhando' : ''), meu: minhas.has(x.id) })),
    conversas, andando, pendentes: c.pendentes.filter(p => p.status === 'aguardando' || Date.now() - (p.decidido || 0) < 864e5).map(({ id, pedido, status, criado, sessao }) => ({ id, pedido, status, criado, sessao })),
  };
}

// ---------- financeiro: tudo o que cada projeto gasta ----------
// custos cadastrados pela dona + rateio da assinatura do Claude (pelo uso) e do servidor (pela memória e disco)
// + serviços pagos que cada projeto usa (lidos do package.json e .env.example, nunca do .env de verdade)
const ARQ_FINANCEIRO = path.join(DADOS, 'financeiro.json');
let financeiro = { custos: [] };
try { financeiro = { custos: [], ...JSON.parse(fs.readFileSync(ARQ_FINANCEIRO, 'utf8')) }; } catch { /* começa vazio */ }
const gravarFinanceiro = () => gravarJSON(ARQ_FINANCEIRO, financeiro);
const CATEGORIAS = ['claude', 'servidor', 'dominio', 'loja', 'api', 'servico', 'outro'];
function salvarCusto(d) {
  const nome = String(d.nome || '').trim().slice(0, 80), valor = Number(String(d.valor || '').replace(',', '.'));
  if (nome.length < 2) return { erro: 'Dê um nome ao custo.' };
  if (!(valor >= 0) || valor > 1e7) return { erro: 'Valor inválido.' };
  const setor = d.setor === 'geral' || listaSetores().some(x => x.id === d.setor) ? d.setor : 'geral';
  const recorrencia = ['mensal', 'anual', 'unico'].includes(d.recorrencia) ? d.recorrencia : 'mensal';
  const categoria = CATEGORIAS.includes(d.categoria) ? d.categoria : 'outro';
  financeiro.custos.push({ id: novoId(), nome, valor, recorrencia, categoria, setor, criado: Date.now() });
  gravarFinanceiro(); avisar(); cacheFinanceiro.em = 0;
  return { ok: true };
}
const SERVICOS_PAGOS = [
  [/^stripe$|@stripe\//, 'Stripe (pagamentos)'], [/mercadopago|mercado-pago/, 'Mercado Pago'], [/^openai$|OPENAI_/, 'OpenAI (API)'], [/@anthropic-ai\/sdk|ANTHROPIC_API/, 'Anthropic (API)'],
  [/@google\/generative-ai|@google\/genai|GEMINI_/, 'Google Gemini (API)'], [/@sentry\//, 'Sentry'], [/^firebase|firebase_|FIREBASE_/, 'Firebase'], [/^twilio$/, 'Twilio'],
  [/@sendgrid|SENDGRID_/, 'SendGrid'], [/^resend$|RESEND_/, 'Resend (e-mail)'], [/@aws-sdk|^aws-sdk$|AWS_/, 'AWS'], [/@google-cloud/, 'Google Cloud'], [/onesignal/i, 'OneSignal'],
  [/^pusher|PUSHER_/, 'Pusher'], [/algolia/i, 'Algolia'], [/mapbox|GOOGLE_MAPS/i, 'Mapas (Mapbox/Google)'], [/@supabase|SUPABASE_/, 'Supabase'], [/^@vercel|VERCEL_/, 'Vercel'],
  [/EVOLUTION_|evolution-api/, 'Evolution API (WhatsApp)'], [/^@linear|LINEAR_/, 'Linear'], [/cloudinary/i, 'Cloudinary'], [/^@prisma\/accelerate/, 'Prisma Accelerate'],
];
function servicosDoProjeto(pastas) {
  const achados = new Set(), arquivos = [];
  const varrer = (dir, nivel) => {
    if (nivel > 3) return;
    let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (['node_modules', '.git', 'dist', 'build', '.next', 'vendor', '.dart_tool'].includes(e.name)) continue;
      const q = path.join(dir, e.name);
      if (e.isDirectory()) varrer(q, nivel + 1);
      else if (e.name === 'package.json' || e.name === 'pubspec.yaml' || /^\.env\.(example|sample|exemplo)$/.test(e.name)) arquivos.push(q);
    }
  };
  for (const p of pastas || []) varrer(p, 0);
  for (const a of arquivos.slice(0, 60)) {
    let txt = ''; try { txt = fs.readFileSync(a, 'utf8'); } catch { continue; }
    let chaves = [];
    if (a.endsWith('package.json')) { try { const j = JSON.parse(txt); chaves = Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) }); } catch { /* ignora */ } }
    else if (a.endsWith('pubspec.yaml')) chaves = (txt.match(/^\s{2}([a-z0-9_]+):/gm) || []).map(x => x.trim().replace(':', ''));
    else chaves = (txt.match(/^[A-Z][A-Z0-9_]+(?==)/gm) || []); // só os NOMES das variáveis do exemplo
    for (const k of chaves) for (const [re, nome] of SERVICOS_PAGOS) if (re.test(k)) achados.add(nome);
  }
  return [...achados].sort();
}
let cacheFinanceiro = { em: 0, dados: null }, cacheDisco = { em: 0, porSetor: {} }, cacheServicos = { em: 0, porSetor: {} };
async function dadosFinanceiros() {
  if (Date.now() - cacheFinanceiro.em < 5 * 60_000 && cacheFinanceiro.dados) return cacheFinanceiro.dados;
  const agora = Date.now(), visiveis = new Set(listaSetores().map(x => x.id)), setores = setoresComPastas().filter(x => visiveis.has(x.id) && x.id !== 'escritorio');
  const mensal = c => c.recorrencia === 'anual' ? c.valor / 12 : c.recorrencia === 'unico' ? 0 : c.valor;
  // uso do Claude nos últimos 30 dias, por projeto (tokens) — base do rateio da assinatura
  const tokens = {}, usd = {};
  for (const r of relatorios) if (agora - r.fim < 30 * 864e5 && !r.emRevisao && !r.projetoFinal) {
    const t = (r.tokens?.entrada || 0) + (r.tokens?.saida || 0) + (r.tokens?.cache || 0) / 10;
    tokens[r.setor] = (tokens[r.setor] || 0) + t; usd[r.setor] = (usd[r.setor] || 0) + (r.custoUSD || 0);
  }
  const totTokens = Object.values(tokens).reduce((a, b) => a + b, 0) || 1;
  // memória por projeto (containers agrupados pelo datacenter)
  const mem = {};
  const st = await rodar('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.MemUsage}}'], null, 30_000);
  for (const l of st.saida.split('\n').filter(Boolean)) {
    const [nome, uso] = l.split('|'), m = String(uso || '').match(/([\d.]+)\s*([KMG]i?B)/i);
    if (!m) continue;
    const mb = Number(m[1]) * ({ k: 1 / 1024, m: 1, g: 1024 }[m[2][0].toLowerCase()] || 1);
    const g = grupoDoContainer(nome); if (g.setor) mem[g.setor] = (mem[g.setor] || 0) + mb;
  }
  // disco por projeto (pastas do projeto), medido no máximo 1 vez por dia
  if (agora - cacheDisco.em > 864e5) {
    const porSetor = {};
    for (const x of setores) { let b = 0; for (const p of x.pastas || []) { const r = await rodar('du', ['-sb', '--exclude=node_modules', p], null, 60_000); b += Number((r.saida.split('\t')[0]) || 0); } porSetor[x.id] = Math.round(b / 1048576); }
    cacheDisco = { em: agora, porSetor };
  }
  if (agora - cacheServicos.em > 864e5) { const porSetor = {}; for (const x of setores) porSetor[x.id] = servicosDoProjeto(x.pastas); cacheServicos = { em: agora, porSetor }; }
  const totMem = Object.values(mem).reduce((a, b) => a + b, 0) || 1, totDisco = Object.values(cacheDisco.porSetor).reduce((a, b) => a + b, 0) || 1;
  const fixosGerais = financeiro.custos.filter(c => c.setor === 'geral');
  const assinatura = fixosGerais.filter(c => c.categoria === 'claude').reduce((a, c) => a + mensal(c), 0);
  const servidor = fixosGerais.filter(c => c.categoria === 'servidor').reduce((a, c) => a + mensal(c), 0);
  const outrosGerais = fixosGerais.filter(c => !['claude', 'servidor'].includes(c.categoria)).reduce((a, c) => a + mensal(c), 0);
  const projetos = setores.filter(x => x.id !== 'geral').map(x => {
    const diretos = financeiro.custos.filter(c => c.setor === x.id).reduce((a, c) => a + mensal(c), 0);
    const pClaude = (tokens[x.id] || 0) / totTokens, pServ = 0.7 * (mem[x.id] || 0) / totMem + 0.3 * (cacheDisco.porSetor[x.id] || 0) / totDisco;
    const rClaude = assinatura * pClaude, rServ = servidor * pServ;
    return { setor: x.id, nome: x.nome, cor: x.cor, diretos, claude: rClaude, servidor: rServ, total: diretos + rClaude + rServ, usoClaude: Math.round(pClaude * 100), memoriaMB: Math.round(mem[x.id] || 0),
      discoMB: cacheDisco.porSetor[x.id] || 0, equivalenteApiUSD: usd[x.id] || 0, servicos: cacheServicos.porSetor[x.id] || [] };
  }).sort((a, b) => b.total - a.total);
  const totalMensal = financeiro.custos.reduce((a, c) => a + mensal(c), 0);
  const dados = { agora, custos: financeiro.custos, projetos, totalMensal, assinatura, servidor, outrosGerais, cambio: cambio.brl || null,
    semRateio: Math.max(0, assinatura + servidor - projetos.reduce((a, x) => a + x.claude + x.servidor, 0)) };
  cacheFinanceiro = { em: Date.now(), dados };
  return dados;
}

// ---------- departamentos: áreas da empresa com sala, membros e rotina ----------
const deps = () => config.departamentos || [];
let propostasRH = [];
try { propostasRH = JSON.parse(fs.readFileSync(path.join(DADOS, 'propostas-rh.json'), 'utf8')); } catch { propostasRH = []; }
const gravarPropostasRH = () => gravarJSON(path.join(DADOS, 'propostas-rh.json'), propostasRH.slice(0, 60));
function entregasRecentes(dias, setor) {
  const desde = Date.now() - dias * 864e5;
  return relatorios.filter(r => r.fim > desde && !r.rotina && !r.emRevisao && (!setor || r.setor === setor))
    .map(r => `- ${diaDe(r.fim)} · ${nomeSetor(r.setor)} · ${r.agente}${r.especialidade ? ' (' + r.especialidade + ')' : ''}: ${r.simples?.titulo || curto(semQuebra(r.pedido), 100)}`).slice(0, 80).join('\n') || '(nenhuma entrega no período)';
}
async function dadosDoDepartamento(dep) {
  const projetos = listaSetores().filter(x => !['geral', 'escritorio'].includes(x.id)).map(x => `- ${x.nome}`).join('\n');
  const base = `Projetos da empresa:\n${projetos}`;
  if (dep.id === 'financeiro') {
    const f = await dadosFinanceiros();
    return `${base}\n\nDADOS FINANCEIROS (medidos agora, em R$/mês):\nTotal de custos cadastrados: ${f.totalMensal.toFixed(2)} | assinatura Claude: ${f.assinatura.toFixed(2)} | servidor: ${f.servidor.toFixed(2)} | outros gerais: ${f.outrosGerais.toFixed(2)}\n` +
      f.projetos.map(x => `- ${x.nome}: total ${x.total.toFixed(2)} (diretos ${x.diretos.toFixed(2)}, parte do Claude ${x.claude.toFixed(2)} = ${x.usoClaude}% do uso, parte do servidor ${x.servidor.toFixed(2)} = ${x.memoriaMB} MB de memória e ${x.discoMB} MB de disco); equivalente na API (não cobrado): US$ ${x.equivalenteApiUSD.toFixed(2)}; serviços pagos detectados: ${x.servicos.join(', ') || 'nenhum'}`).join('\n') +
      `\nCustos cadastrados:\n${f.custos.map(c => `- ${c.nome} (${c.categoria}, ${c.recorrencia}, ${nomeSetor(c.setor)}): R$ ${c.valor}`).join('\n') || '(nenhum: peça para a dona cadastrar em Painel › Financeiro)'}`;
  }
  if (dep.id === 'rh') {
    const agora = Date.now(), linhas = [];
    for (const e of config.especialidades || []) {
      const meus = relatorios.filter(r => r.especialidade === e.id), mes = meus.filter(r => agora - r.fim < 30 * 864e5);
      const ult = meus.reduce((a, r) => Math.max(a, r.fim), 0);
      linhas.push(`- ${e.id} (${e.nome}): ${mes.length} entregas em 30 dias, ${mes.filter(r => r.avaliacao?.tipo === 'refazer').length} para refazer, QA ${mes.filter(r => r.revisao?.aprovado).length}/${mes.filter(r => r.revisao).length} aprovadas, última ${ult ? diaDe(ult) : 'nunca'}`);
    }
    const semDono = relatorios.filter(r => agora - r.fim < 30 * 864e5 && (!r.especialidade || r.especialidade === 'generalista') && !r.rotina).map(r => `- ${nomeSetor(r.setor)}: ${curto(semQuebra(r.pedido), 120)}`).slice(0, 40).join('\n');
    const repasses = [...ordens.values()].filter(o => o.repasse).map(o => `- ${o.repasse.de} → ${o.repasse.para}: ${curto(o.pedido, 100)}`).slice(0, 20).join('\n');
    return `${base}\n\nEQUIPE ATUAL:\n${linhas.join('\n')}\n\nPEDIDOS DOS ÚLTIMOS 30 DIAS QUE FICARAM SEM ESPECIALISTA (generalista):\n${semDono || '(nenhum)'}\n\nREPASSES ENTRE ESPECIALISTAS:\n${repasses || '(nenhum)'}`;
  }
  if (dep.id === 'melhorias') return dadosDasMelhorias();
  if (dep.id === 'produto') return `${base}\n\nENTREGAS DO MÊS:\n${entregasRecentes(30)}\n\nIDEIAS ANOTADAS:\n${ideias.filter(i => i.status !== 'mandada').map(i => `- ${nomeSetor(i.setor)}: ${i.titulo} (${i.prioridade})`).join('\n') || '(nenhuma)'}\n\nMETAS:\n${metas.filter(m => m.status === 'ativa').map(m => `- ${nomeSetor(m.setor)}: ${m.titulo}${m.prazo ? ' até ' + m.prazo : ''} (${m.passos.filter(x => x.status === 'feito').length}/${m.passos.length})`).join('\n') || '(nenhuma)'}`;
  if (dep.id === 'academia' || dep.id === 'comunidade') return `${base}\n\nO QUE A EQUIPE FEZ NOS ÚLTIMOS 7 DIAS:\n${entregasRecentes(7)}`;
  if (dep.id === 'seguranca') return `${base}\n\nPasta raiz dos projetos: ${RAIZ_PROJETOS}. Faça uma auditoria só de leitura: .env versionado no git, chaves ou senhas no código, rotas de API sem autenticação, dados pessoais sem cuidado. Olhe por amostragem, priorize o que está em produção.`;
  return `${base}\n\nENTREGAS DOS ÚLTIMOS 30 DIAS:\n${entregasRecentes(30)}`;
}
const PEDIDOS_DEP = {
  melhorias: 'Você é o setor de CRESCIMENTO do escritório. Proponha no MÁXIMO 2 ideias para o escritório crescer: novos setores/departamentos (com sala, especialista e rotina), novas funcionalidades, melhorias visuais no 3D e no painel, mudanças de layout ou tecnologia nova que deixe o escritório mais útil e bonito. Pense como dono de produto: o que deixaria a dona mais produtiva ou impressionada? Cada ideia precisa caber numa tarefa de algumas horas e não pode repetir as que já foram propostas, feitas ou recusadas. Varie os tipos (setor, visual, funcionalidade, tecnologia).',
  rh: 'Faça a reunião mensal de RH da equipe de especialistas. Proponha contratações SÓ se houver demanda real sem especialista (pedidos no generalista ou repasses), treinamentos para quem teve muitos "refazer" e aposentadoria para quem está parado há mais de 60 dias.',
  financeiro: 'Faça o relatório financeiro da semana: quanto cada projeto custa por mês e por quê, o que mudou, gastos fora do normal e propostas de economia (com valor estimado). Se faltar custo cadastrado (assinatura do Claude, VPS, domínios, lojas, APIs), diga exatamente o que a dona deve cadastrar.',
  marketing: 'Monte o plano de marketing da semana: para os produtos com mais chance agora, uma proposta de campanha (público, mensagem, canal) e 3 rascunhos de posts prontos para revisar. Pesquise concorrentes na web quando ajudar e cite as fontes.',
  inovacao: 'Faça o estudo mensal de inovação: 3 a 5 áreas ou nichos novos onde a empresa poderia atuar, cada um com nota de 0 a 10 em mercado, esforço, risco e encaixe com o que a empresa já sabe fazer, uma nota final de chance, fontes e o primeiro passo barato para testar.',
  parcerias: 'Procure editais, aceleradoras, programas de startups e possíveis parceiros (foco no Brasil) que combinem com os produtos da empresa. Para cada um: prazo, requisitos, link e por que combina. Ordene por chance e prazo.',
  produto: 'Monte o roadmap do mês: prioridades por produto, o que deveria ser feito primeiro e por quê, usando as entregas, ideias e metas.',
  seguranca: 'Faça a auditoria mensal de segurança, só de leitura. Liste os riscos achados por gravidade, com o arquivo e o que fazer. Nunca mostre o valor de segredos encontrados, só onde estão.',
  academia: 'Monte o plano de estudos da semana a partir do que a equipe fez: 3 a 5 conceitos que valem aprender (explicação curta e um material gratuito bom), 2 desafios práticos pequenos e uma linha para o diário de aprendizado.',
  comunidade: 'Proponha 2 ideias de post técnico a partir do que foi construído na semana, com um rascunho completo do melhor (sem nomes de clientes, caminhos ou dados privados).',
};
const estadoDeps = () => (estadoRotinas.departamentos ||= {});
async function rodarDepartamento(id, origem = 'agenda') {
  const dep = deps().find(d => d.id === id);
  if (!dep) return { erro: 'Departamento não encontrado.' };
  const ed = estadoDeps(), e = (ed[id] ||= {});
  if (e.rodando) return { erro: 'Esse departamento já está trabalhando nisso.' };
  const lider = lerEspecialista(dep.lider);
  if (!lider) return { erro: 'O líder desse departamento não tem manual.' };
  e.rodando = true; e.inicio = Date.now(); avisar();
  try {
    const dados = await dadosDoDepartamento(dep);
    const pedidoDep = PEDIDOS_DEP[id] || `Faça o relatório do mês do departamento ${dep.nome}: o que vale fazer agora para a empresa, com base nos dados.`;
    const extraMelhorias = id === 'melhorias' ? `,\n "melhorias": [{"titulo": "frase curta", "tipo": "setor|visual|funcionalidade|tecnologia|layout", "porque": "o ganho para a dona, em português simples", "oque": "o que construir, com arquivos e passos", "risco": "baixo|médio, e por quê", "tamanho": "pequena|média"}]` : '';
    const extraRH = id === 'rh' ? `,\n "contratacoes": [{"id": "minusculas-e-hifen", "nome": "...", "cor": "#RRGGBB", "modelo": "sonnet|opus|haiku", "ferramentas": ["Read", "..."], "descricao": "1 frase", "manual": "manual completo em Markdown, 15 a 40 linhas, no estilo: Você é o especialista em X da ${EMPRESA()}...", "arquivos": "regex ou vazio", "motivo": "por que contratar"}]` : '';
    const prompt = `Você é o departamento ${dep.nome} da ${EMPRESA()}. ${pedidoDep}\n\nDados (coletados agora pelo escritório):\n${dados}\n\nResponda APENAS JSON: {"titulo": "frase curta", "resumo": "2 a 4 frases simples para a dona (ela não é técnica)", "itens": ["o que você achou/propõe, um por item, concreto"], "proximos": ["próximo passo sugerido"], "pergunta": "pergunta para a dona se precisar de uma decisão, senão vazio", "detalhe": "relatório completo em Markdown"${extraRH}${extraMelhorias}}`;
    const ferramentas = dep.web ? ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'] : ['Read', 'Grep', 'Glob'];
    const def = { [dep.lider]: { description: lider.descricao || lider.nome, prompt: `${contextoEmpresa()}\n\n---\n\n${lider.manual}\n\nNesta tarefa você só lê e pesquisa: não altera nada.`, model: lider.modelo || 'sonnet', tools: ferramentas } };
    const pasta = dep.id === 'seguranca' ? RAIZ_PROJETOS : dep.id === 'melhorias' ? RAIZ : '/tmp';
    const txt = await rodarClaudeLeitura(pasta, config.rotinas?.departamentos?.conta || Object.keys(config.contas || { pessoal: '' })[0], prompt, def, dep.lider, 20 * 60_000);
    let j; try { j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { throw new Error('o departamento não devolveu o relatório no formato esperado'); }
    const lista = x => (Array.isArray(x) ? x : []).slice(0, 12).map(v => censurarTexto(String(v)).slice(0, 400));
    if (id === 'rh') for (const c of (Array.isArray(j.contratacoes) ? j.contratacoes : []).slice(0, 4)) {
      const cid = String(c.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
      if (!cid || especialidadeExiste(cid) || propostasRH.some(p => p.especialista.id === cid && p.status === 'aguardando')) continue;
      propostasRH.unshift({ id: novoId(), status: 'aguardando', criada: Date.now(), motivo: censurarTexto(String(c.motivo || '')).slice(0, 500),
        especialista: { id: cid, nome: String(c.nome || cid).slice(0, 60), cor: /^#[0-9a-f]{6}$/i.test(c.cor) ? c.cor : '#5F5E5A', modelo: ['sonnet', 'opus', 'haiku'].includes(c.modelo) ? c.modelo : 'sonnet',
          ferramentas: Array.isArray(c.ferramentas) ? c.ferramentas.filter(f => FERRAMENTAS_OK.includes(f)) : ['Read', 'Grep', 'Glob'], descricao: String(c.descricao || '').slice(0, 200), manual: String(c.manual || '').slice(0, 8000), arquivos: String(c.arquivos || '').slice(0, 300) } });
      gravarPropostasRH();
    }
    let novasMelhorias = 0;
    if (id === 'melhorias') for (const m of (Array.isArray(j.melhorias) ? j.melhorias : []).slice(0, 2)) {
      const titulo = censurarTexto(String(m.titulo || '')).slice(0, 140);
      if (!titulo || propostasMelhoria.some(x => x.titulo.toLowerCase() === titulo.toLowerCase())) continue;
      propostasMelhoria.unshift({ id: novoId(), status: 'aguardando', criada: Date.now(), titulo, tipo: ['setor', 'visual', 'funcionalidade', 'tecnologia', 'layout'].includes(m.tipo) ? m.tipo : 'funcionalidade', porque: censurarTexto(String(m.porque || '')).slice(0, 800), oque: censurarTexto(String(m.oque || '')).slice(0, 2000), risco: censurarTexto(String(m.risco || '')).slice(0, 300), tamanho: m.tamanho === 'média' ? 'média' : 'pequena' });
      novasMelhorias++;
    }
    if (novasMelhorias) { gravarPropostasMelhoria(); notificar('esperando', `Crescimento do escritório: ${novasMelhorias} proposta(s) esperando a sua aprovação.`); }
    if (id === 'melhorias' && !novasMelhorias) { e.ultima = Date.now(); e.erro = ''; return { ok: true, nada: true }; } // sem proposta: não manda relatório
    const contratacoes = id === 'rh' ? propostasRH.filter(p => p.status === 'aguardando').length : 0;
    entregarRotina({ sessao: 'dep-' + id, agente: dep.nome, setor: 'geral', especialidade: dep.lider, cwd: pasta, conta: 'empresa', pedido: `Rotina do departamento ${dep.nome}`,
      resposta: censurarTexto(String(j.detalhe || j.resumo || '')).slice(0, 12000),
      simples: { titulo: censurarTexto(String(j.titulo || dep.nome)).slice(0, 160), resumo: censurarTexto(String(j.resumo || '')).slice(0, 1200), feito: lista(j.itens),
        resultado: { status: contratacoes ? 'atencao' : 'ok', texto: contratacoes ? `${contratacoes} proposta(s) de contratação esperando você em Painel › Empresa.` : '' },
        proximos: lista(j.proximos), termos: [], pergunta: censurarTexto(String(j.pergunta || '')).slice(0, 600), bloqueio: '' } });
    e.ultima = Date.now(); e.erro = '';
    notificar('esperando', `${dep.nome}: ${curto(String(j.titulo || 'relatório pronto'), 120)}`);
    return { ok: true };
  } catch (err) { e.erro = String(err.message || err).slice(0, 200); throw err; }
  finally { e.rodando = false; gravarRotinas(); avisar(); }
}
// melhorias do escritório: propostas que só viram tarefa com a aprovação da dona
let propostasMelhoria = [];
try { propostasMelhoria = JSON.parse(fs.readFileSync(path.join(DADOS, 'propostas-melhoria.json'), 'utf8')); } catch { propostasMelhoria = []; }
const gravarPropostasMelhoria = () => gravarJSON(path.join(DADOS, 'propostas-melhoria.json'), propostasMelhoria.slice(0, 120));
async function dadosDasMelhorias() {
  const desde = Date.now() - 7 * 864e5;
  const pedidos = relatorios.filter(r => r.setor === 'escritorio' && r.fim > desde && !r.rotina).map(r => `- ${diaDe(r.fim)}: ${curto(semQuebra(r.pedido), 220)}`).slice(0, 30).join('\n');
  const erros = await rodar('journalctl', ['-u', 'escritorio-agentes', '--since', '-6h', '--no-pager', '-o', 'cat'], null, 15_000);
  const linhasErro = erros.saida.split('\n').filter(l => /erro|error|falhou|exception|TypeError|ReferenceError/i.test(l)).slice(-25).map(l => '- ' + censurarTexto(l).slice(0, 220)).join('\n');
  const historico = propostasMelhoria.slice(0, 30).map(x => `- [${x.status}] ${x.titulo}${x.motivoRecusa ? ` (recusada: ${x.motivoRecusa})` : ''}`).join('\n');
  const incs = incidentes.filter(i => i.desde > desde).map(i => `- ${i.titulo} (${i.status})`).slice(0, 10).join('\n');
  const tem = `SETORES QUE JÁ EXISTEM: ${deps().map(d => d.nome).join(', ')}\nSEÇÕES DO PAINEL: Geral, Atividade, Plano (metas, ideias, quadro), Projetos, Publicações, Empresa, Finanças, Equipe, Infra\nJÁ TEM: escritório 3D com salas por projeto e andar da empresa, conversas com abas, reuniões entre especialistas, convidados, busca Ctrl+K, resumo da manhã, vigia de containers e WhatsApp, histórico de publicações, clima real.`;
  return `${tem}\n\nPEDIDOS E RECLAMAÇÕES DA DONA SOBRE O ESCRITÓRIO (7 dias):\n${pedidos || '(nenhum)'}\n\nERROS NOS REGISTROS DO ESCRITÓRIO (6 horas):\n${linhasErro || '(nenhum)'}\n\nINCIDENTES (7 dias):\n${incs || '(nenhum)'}\n\nPROPOSTAS ANTERIORES (não repita as recusadas nem as que já foram feitas):\n${historico || '(nenhuma)'}\n\nPasta do escritório: ${RAIZ} (leia o código para embasar).`;
}
async function decidirMelhoria(id, aprovar, motivo, ip) {
  const pr = propostasMelhoria.find(x => x.id === id);
  if (!pr || pr.status !== 'aguardando') return { erro: 'Essa proposta não está aguardando.' };
  if (!aprovar) { pr.status = 'recusada'; pr.motivoRecusa = String(motivo || '').trim().slice(0, 300); pr.decidida = Date.now(); gravarPropostasMelhoria(); avisar(); return { ok: true }; }
  const conta = config.rotinas?.departamentos?.conta || Object.keys(config.contas || { pessoal: '' })[0];
  const r = await novaOrdem({ setor: 'escritorio', papel: 'melhorias', conta, modo: 'executar',
    pedido: `Ideia de crescimento do escritório aprovada pela dona (${pr.tipo || 'funcionalidade'}): ${pr.titulo}\n\nPor quê: ${pr.porque}\n\nO que fazer: ${pr.oque}\n\nRisco apontado: ${pr.risco || 'baixo'}\n\nSiga o seu manual: mudança pequena, conferir, commit e registrar a publicação com escritorio-publicar.` }, ip, 'melhoria', { pedidoVisivel: `Crescimento: ${pr.titulo}` });
  if (r.erro) return r;
  const o = ordens.get(r.id); if (o) o.triada = true; // já vai para o engenheiro do escritório, sem triagem
  pr.status = 'aprovada'; pr.ordem = r.id; pr.decidida = Date.now(); gravarPropostasMelhoria(); avisar();
  return { ok: true, ordem: r.id };
}

function decidirContratacao(id, aprovar) {
  const pr = propostasRH.find(x => x.id === id);
  if (!pr || pr.status !== 'aguardando') return { erro: 'Essa proposta não está aguardando.' };
  if (aprovar) {
    const e = pr.especialista;
    if (!e.manual || e.manual.length < 100) return { erro: 'O manual proposto está incompleto.' };
    contratarEspecialistas([{ ...e, manual: e.manual, ferramentas: e.ferramentas.length ? e.ferramentas : 'todas' }]);
    infoEspecialistas = resumoEspecialistas();
    editarConfig(c => { const rh = (c.departamentos || []).find(d => d.id === 'rh'); if (rh && !(rh.contratados ||= []).includes(e.id)) rh.contratados.push(e.id); });
  }
  pr.status = aprovar ? 'aprovada' : 'recusada'; pr.decidida = Date.now(); gravarPropostasRH(); avisar();
  return { ok: true };
}
// agenda das rotinas dos departamentos (fuso da empresa)
setInterval(() => {
  const { data, hora, dia } = agoraNoFuso(), diaMes = Number(data.slice(8, 10));
  for (const dep of deps()) {
    const r = dep.rotina, e = estadoDeps()[dep.id] ||= {};
    if (r?.ativo && r.freq === 'horas') {
      const [h, m] = hora.split(':').map(Number), marcaH = `${data} ${h}`;
      if (m !== 0 || h < (r.inicio ?? 8) || h >= (r.fim ?? 20) || (h - (r.inicio ?? 8)) % (r.intervalo || 2) !== 0 || e.marca === marcaH) continue;
      if (dep.id === 'melhorias' && propostasMelhoria.filter(x => x.status === 'aguardando').length >= (r.maxPendentes || 20)) continue; // acumula até um teto, para não gastar à toa
      e.marca = marcaH;
      rodarDepartamento(dep.id, 'agenda').catch(err => console.error('departamento', dep.id + ':', err.message));
      continue;
    }
    if (!r?.ativo || r.hora !== hora || e.marca === data) continue;
    const hoje = r.freq === 'mensal' ? diaMes === r.dia : dia === r.dia;
    if (!hoje) continue;
    e.marca = data;
    rodarDepartamento(dep.id, 'agenda').catch(err => console.error('departamento', dep.id + ':', err.message));
  }
}, 20_000);

// ---------- painel lateral: gráficos, equipe e saúde ----------
// o que é de cada um além das tarefas que recebe (rotinas e papéis fixos da empresa)
const RESPONSABILIDADES = {
  devops: ['Ronda da produção todo dia de manhã (containers, disco, memória, backups, certificados)', 'Investiga os incidentes que o vigia abre', 'Publica em produção quando você aperta Publicar'],
  po: ['Refina os pedidos do produto antes de ir para o especialista', 'Resumo semanal do produto', 'Prioriza o que entra primeiro'],
  estrategia: ['Memorando estratégico todo mês', 'Olha a empresa inteira: projetos, custo, ritmo e riscos'],
  testes: ['Revisa as entregas dos colegas antes de chegarem na sua mesa (QA)', 'Roda testes, lint e build', 'Devolve para correção quando acha problema'],
  seguranca: ['Revisa riscos de segurança: login, permissões, segredos e dados de clientes'],
  whatsapp: ['Cuida do WhatsApp das lojas (Evolution, conexão, mensagens)'],
};
async function estadoBackup() {
  const r = await rodar('systemctl', ['show', 'escritorio-backup.service', '-p', 'Result', '-p', 'ExecMainExitTimestamp', '--value'], null, 10_000);
  const [resultado, quando] = r.saida.trim().split('\n');
  let ultimo = null;
  try { const arqs = fs.readdirSync(config.backupEscritorio || '/nao-configurado').filter(x => x.endsWith('.tar.gz')).sort(); ultimo = arqs.at(-1) || null; } catch { /* sem pasta */ }
  return { resultado: resultado || '', quando: quando ? Date.parse(quando) || null : null, ultimo };
}
async function dadosDoPainel() {
  const agora = Date.now(), dia = 864e5, brl = cambio.brl || 0;
  const rels = relatorios.filter(r => !r.emRevisao && !r.projetoFinal);
  const usd = r => r.custoUSD ?? 0;
  // tarefas por dia (14 dias), separadas por projeto
  const dias = [];
  for (let k = 13; k >= 0; k--) dias.push(diaDe(agora - k * dia));
  const porDia = Object.fromEntries(dias.map(d => [d, { total: 0, setores: {} }]));
  for (const r of rels) { const d = porDia[diaDe(r.fim)]; if (d) { d.total++; d.setores[r.setor] = (d.setores[r.setor] || 0) + 1; } }
  // por projeto (30 dias)
  const porSetor = {};
  for (const r of rels.filter(r => agora - r.fim < 30 * dia)) {
    const p = (porSetor[r.setor] ||= { setor: r.setor, nome: nomeSetor(r.setor), tarefas: 0, semana: 0, usd: 0, ultima: 0, minutos: 0 });
    p.tarefas++; if (agora - r.fim < 7 * dia) p.semana++; p.usd += usd(r); p.ultima = Math.max(p.ultima, r.fim); p.minutos += Math.max(0, r.fim - r.inicio) / 60_000;
  }
  // equipe: o que cada especialista fez e como foi avaliado
  const equipe = (config.especialidades || []).map(e => {
    const x = infoEspecialistas[e.id] || {}, meus = rels.filter(r => r.especialidade === e.id), mes = meus.filter(r => agora - r.fim < 30 * dia);
    const revisados = mes.filter(r => r.revisao), aprovados = revisados.filter(r => r.revisao.aprovado);
    return { id: e.id, nome: e.nome, cor: e.cor, modelo: x.modelo || '', descricao: x.descricao || '', edita: !x.soLeitura, comandos: !x.semComandos,
      responsabilidades: RESPONSABILIDADES[e.id] || [], tarefas: meus.length, mes: mes.length, usdMes: mes.reduce((a, r) => a + usd(r), 0),
      revisados: revisados.length, aprovados: aprovados.length, refazer: mes.filter(r => r.avaliacao?.tipo === 'refazer').length,
      ultima: meus.reduce((a, r) => Math.max(a, r.fim), 0), projetos: [...new Set(mes.map(r => nomeSetor(r.setor)))].slice(0, 6) };
  });
  const revisados = rels.filter(r => agora - r.fim < 30 * dia && r.revisao);
  // linha do tempo das últimas 48h
  const desde = agora - 2 * dia, atividade = [];
  for (const r of rels) if (r.fim > desde) atividade.push({ t: r.fim, tipo: 'entrega', setor: r.setor, sessao: r.sessao, texto: `${r.agente} entregou: ${curto(semQuebra(r.pedido), 110)}`, ok: r.revisao ? r.revisao.aprovado : null });
  for (const i of incidentes) {
    if (i.desde > desde) atividade.push({ t: i.desde, tipo: 'incidente', setor: i.setor, texto: `Incidente: ${i.titulo}` });
    if (i.resolvido > desde) atividade.push({ t: i.resolvido, tipo: 'resolvido', setor: i.setor, texto: `Resolvido: ${i.titulo}` });
  }
  for (const d of deploys) {
    if (d.criado > desde) atividade.push({ t: d.criado, tipo: 'publicacao', setor: d.setor, sessao: d.sessao, texto: `${d.agente} preparou uma publicação: ${curto(semQuebra(d.resumo), 100)}` });
    if (d.status === 'publicado' && d.fim > desde) atividade.push({ t: d.fim, tipo: 'publicado', setor: d.setor, texto: `Publicado em produção: ${curto(semQuebra(d.resumo), 100)}` });
  }
  for (const v of previas) if (v.criada > desde) atividade.push({ t: v.criada, tipo: 'previa', setor: v.setor, sessao: v.sessao, texto: `${v.agente} abriu uma prévia: ${curto(v.descricao, 100)}` });
  for (const p of projetos) if (p.criado > desde) atividade.push({ t: p.criado, tipo: 'projeto', setor: p.setor, texto: `Novo projeto com o gerente: ${p.titulo}` });
  for (const i of ideias) if (i.mandada > desde) atividade.push({ t: i.mandada, tipo: 'ideia', setor: i.setor, texto: `Ideia virou tarefa: ${i.titulo}` });
  atividade.sort((a, b) => b.t - a.t);
  const ultimasPorSetor = {};
  for (const r of [...rels].sort((a, b) => b.fim - a.fim)) {
    const l = (ultimasPorSetor[r.setor] ||= []);
    if (l.length < 4) l.push({ t: r.fim, agente: r.agente, sessao: r.sessao, pedido: curto(semQuebra(r.pedido), 90) });
  }
  return {
    atividade: atividade.slice(0, 80), ultimasPorSetor,
    agora, brl, dias, porDia, porSetor: Object.values(porSetor).sort((a, b) => b.tarefas - a.tarefas), equipe,
    totais: { hoje: porDia[dias.at(-1)].total, semana: rels.filter(r => agora - r.fim < 7 * dia).length, mes: rels.filter(r => agora - r.fim < 30 * dia).length,
      usdMes: rels.filter(r => agora - r.fim < 30 * dia).reduce((a, r) => a + usd(r), 0),
      aprovacaoQA: revisados.length ? Math.round(revisados.filter(r => r.revisao.aprovado).length / revisados.length * 100) : null, revisados: revisados.length },
    metricas: metricas.slice(-7 * 96), rotinas: saudeRotinas, backup: await estadoBackup(),
    whatsapp: { conferidoEm: whatsapp.conferidoEm, numeros: whatsapp.numeros.filter(n => n.mensagens7d > 0 || n.estado === 'open') },
    escritorio: { desde: INICIO, memoriaMB: Math.round(process.memoryUsage().rss / 1048576), relatorios: relatorios.length },
  };
}

// recalcula a especialidade das entregas do app (sem ordem do escritório) pela lista de arquivos, sem os bastidores
function recalcularEspecialidades() {
  let mudou = 0;
  for (const r of relatorios) {
    if (r.ordem || r.rotina || !Array.isArray(r.arquivos) || !r.arquivos.length) continue;
    const pts = {};
    for (const a of r.arquivos) { const p = papelDoArquivo(a); if (p) pts[p] = (pts[p] || 0) + 2; }
    const [melhor, n] = Object.entries(pts).sort((a, b) => b[1] - a[1])[0] || [];
    const nova = n >= 3 ? melhor : 'generalista';
    if (nova !== r.especialidade) { r.especialidade = nova; mudou++; }
  }
  if (mudou) gravarRelatorios();
  return mudou;
}
if (!estadoRotinas.pontosZerados) { for (const sx of sessoes.values()) if (!sx.papelFixo) { sx.pontosPapel = {}; sx.especialidade = 'generalista'; } estadoRotinas.pontosZerados = Date.now(); gravarRotinas(); }
if (!estadoRotinas.especialidadesRecalculadas) { const n = recalcularEspecialidades(); estadoRotinas.especialidadesRecalculadas = Date.now(); gravarRotinas(); console.log(`especialidades recalculadas em ${n} entrega(s)`); }

// ---------- tempo real (SSE) ----------
const ouvintes = new Set();
function foto() {
  return JSON.stringify({ empresa: config.empresa, setores: listaSetores(), agentes: [...sessoes.values()].map(({ tarefa, transcript, tamFalas, pontosPapel, ...s }) => s),
    naoLidos: relatorios.filter(r => !r.lido && !r.emRevisao).length, versaoRelatorios, hoje: resumoDoDia(),
    plano, clima, conquistas, ultimaConquista, funcionarioDoMes: funcionarioDoMes(), consumo: consumo(), cambio,
    revisoes: [...revisoesAtivas.values()], aoVivo, servidores, servidoresEm,
    aprendizado: { rodando: aprendizado.rodando, pendentes: Object.fromEntries(Object.entries(licoesPendentes()).map(([k, v]) => [k, v.length])),
      propostas: aprendizado.propostas.filter(x => x.status === 'aguardando' || Date.now() - (x.decidida || 0) < 7 * 864e5).slice(0, 30) },
    deploys: deploys.filter(x => x.status === 'aguardando' || Date.now() - (x.fim || x.criado) < 7 * 864e5).slice(0, 30),
    previas: previas.filter(x => x.status === 'ativa' || Date.now() - (x.fim || 0) < 864e5).slice(0, 30),
    incidentes: incidentes.filter(i => i.status === 'aberto' || Date.now() - (i.resolvido || 0) < 3600_000).slice(0, 20),
    rotinas: { config: config.rotinas || {}, estado: estadoRotinas }, pos: config.setores.filter(x => x.po && !config.ocultos.includes(x.id)).map(x => ({ setor: x.id, nome: nomePO(x.id) })), projetos: projetos.slice(0, 20).map(({ pasta, ...p }) => p),
    nomeServidor: config.nomeServidor || 'servidor',
    telegram: telegram ? { ligado: true, eventos: telegram.eventos } : { ligado: false }, minhaSala: config.minhaSala || {},
    especialidades: regrasPapel.map(({ id, nome, cor, instrucao }) => ({ id, nome, cor, instrucao, ...(infoEspecialistas[id] || {}) })),
    contas: Object.keys(config.contas || { pessoal: '' }),
    departamentos: deps().map(d => ({ ...d, estado: estadoDeps()[d.id] || {} })), propostasMelhoria: propostasMelhoria.filter(p => p.status === 'aguardando' || Date.now() - (p.decidida || 0) < 3 * 864e5).slice(0, 20), propostasRH: propostasRH.filter(p => p.status === 'aguardando' || Date.now() - (p.decidida || 0) < 7 * 864e5).slice(0, 20),
    convites: convites.map(({ hash, ...c }) => ({ ...c, ativoAgora: conviteAtivo(c), projeto: nomeSetor(c.setor) })),
    reunioes: reunioes.slice(0, 8).map(({ conta, ...r }) => r),
    metas: metas.filter(m => m.status === 'ativa' || Date.now() - (m.concluida || 0) < 7 * 864e5).slice(0, 40),
    ideias: ideias.filter(i => i.status !== 'mandada' || Date.now() - (i.mandada || 0) < 3 * 864e5).slice(0, 120),
    ordens: [...ordens.values()].map(({ unidade, pasta, textoCompleto, dirAnexos, ...o }) => o), agenda: agenda.map(({ pedido, ...a }) => ({ ...a, pedido: curto(censurar(pedido), 120) })),
    agora: Date.now() });
}
let avisoPendente = null;
function avisar() {
  gravarSessoes();
  if (avisoPendente) return;
  avisoPendente = setTimeout(() => {
    avisoPendente = null;
    const dado = `data: ${foto()}\n\n`;
    for (const r of ouvintes) r.write(dado);
  }, 150);
}
setInterval(() => { for (const r of ouvintes) r.write(': ping\n\n'); }, 25_000);

// ---------- login ----------
const logins = new Map();
const tentativas = new Map();

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}
function logado(req) {
  const t = lerCookie(req, 'escritorio_sessao');
  if (!t) return false;
  const exp = logins.get(t);
  if (!exp || exp < Date.now()) { logins.delete(t); return false; }
  return true;
}
function ipDe(req) {
  const remoto = req.socket.remoteAddress || '';
  if (remoto === '127.0.0.1' || remoto === '::1' || remoto === '::ffff:127.0.0.1') {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return remoto;
}
const iguais = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function verificarSenha(usuario, senha) {
  const auth = lerAuth();
  if (!auth) return false;
  const hash = await new Promise((ok, erro) =>
    crypto.scrypt(String(senha), Buffer.from(auth.sal, 'hex'), 64, { N: auth.N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (e, h) => (e ? erro(e) : ok(h))));
  return iguais(usuario, auth.usuario) && crypto.timingSafeEqual(hash, Buffer.from(auth.hash, 'hex'));
}

// ---------- http ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
const PUBLICOS_SEM_LOGIN = new Set(['/login.html', '/login.js', '/estilo.css', '/favicon.svg']);

function cabecalhos(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
function json(res, cod, obj) { res.writeHead(cod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

function lerCorpo(req, limite) {
  return new Promise((ok, erro) => {
    const partes = []; let tam = 0;
    req.on('data', c => { tam += c.length; if (tam > limite) { erro(new Error('grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', erro);
  });
}

function servirArquivo(res, rota) {
  const alvo = path.normalize(path.join(PUBLICO, rota === '/' ? '/index.html' : rota));
  if (!alvo.startsWith(PUBLICO + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(alvo, (e, dado) => {
    if (e) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dado);
  });
}

const servidor = http.createServer(async (req, res) => {
  cabecalhos(res);
  const url = new URL(req.url, 'http://x');
  const rota = url.pathname;
  try {
    if (rota === '/api/evento' && req.method === 'POST') {
      if (!iguais(req.headers['x-escritorio-token'] || '', TOKEN_HOOK)) return json(res, 401, { erro: 'token' });
      let corpo;
      try { corpo = await lerCorpo(req, LIMITE_EVENTO); } catch { return json(res, 413, { erro: 'grande' }); }
      try {
        const ev = JSON.parse(corpo);
        ev.__ordem = /^[0-9a-f]{12}$/.test(req.headers['x-escritorio-ordem'] || '') ? req.headers['x-escritorio-ordem'] : null;
        const maq = String(req.headers['x-escritorio-maquina'] || '').toLowerCase();
        ev.__maquina = /^[a-z0-9][a-z0-9-]{0,30}$/.test(maq) && maq !== 'local' ? maq : null;
        processar(ev); avisar();
      } catch { return json(res, 400, { erro: 'json' }); }
      return json(res, 200, { ok: true });
    }

    if ((rota === '/api/deploys' || rota === '/api/previas') && req.method === 'POST') {
      if (!iguais(req.headers['x-escritorio-token'] || '', TOKEN_HOOK)) return json(res, 401, { erro: 'token' });
      let d; try { d = JSON.parse(await lerCorpo(req, 32_768) || '{}'); } catch { return json(res, 400, { erro: 'json' }); }
      const ordemId = /^[0-9a-f]{12}$/.test(req.headers['x-escritorio-ordem'] || '') ? req.headers['x-escritorio-ordem'] : null;
      const r = rota === '/api/deploys' ? registrarDeploy(d, ordemId) : await registrarPrevia(d, ordemId);
      return json(res, r.erro ? 400 : 200, r);
    }

    if (rota === '/api/login' && req.method === 'POST') {
      const ip = ipDe(req);
      const t = tentativas.get(ip) || { n: 0, ate: 0 };
      if (t.ate > Date.now()) return json(res, 429, { erro: 'Muitas tentativas. Espere 15 minutos.' });
      if (!lerAuth()) return json(res, 503, { erro: 'Senha ainda não definida. Rode scripts/definir-senha.mjs na VPS.' });
      const { usuario, senha } = JSON.parse(await lerCorpo(req, 4096) || '{}');
      if (await verificarSenha(usuario || '', senha || '')) {
        tentativas.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        logins.set(token, Date.now() + DURACAO_LOGIN_MS);
        res.setHeader('Set-Cookie', `escritorio_sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACAO_LOGIN_MS / 1000}${COOKIE_SEGURO ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      t.n++;
      if (t.n >= 5) { t.ate = Date.now() + 15 * 60_000; t.n = 0; }
      tentativas.set(ip, t);
      await new Promise(r => setTimeout(r, 600));
      return json(res, 401, { erro: 'Usuário ou senha incorretos.' });
    }

    if (rota === '/api/sair' && req.method === 'POST') {
      logins.delete(lerCookie(req, 'escritorio_sessao'));
      res.setHeader('Set-Cookie', 'escritorio_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    if (PUBLICOS_SEM_LOGIN.has(rota) || rota.startsWith('/vendor/')) return servirArquivo(res, rota);

    // link de convite: troca o token do link por uma sessão de convidado
    const lc = rota.match(/^\/convite\/([A-Za-z0-9_-]{20,64})$/);
    if (lc && req.method === 'GET') {
      const c = convites.find(x => x.hash === hashToken(lc[1]));
      if (!conviteAtivo(c)) { res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:system-ui;padding:24px">Este convite expirou ou foi cancelado. Peça um novo link.</p>'); }
      const t = crypto.randomBytes(32).toString('hex');
      convidadosLogados.set(hashToken(t), { convite: c.id, exp: Math.min(c.expira || Infinity, Date.now() + 7 * 864e5) }); gravarSessoesConvidado();
      c.ultimoAcesso = Date.now(); gravarConvites();
      res.writeHead(302, { 'Set-Cookie': `escritorio_convidado=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${COOKIE_SEGURO ? '; Secure' : ''}`, Location: '/convidado.html' });
      return res.end();
    }
    // convidado (sem login da dona): só a página dele e as rotas dele
    if (!logado(req)) {
      const cv = convidadoDe(req);
      if (cv) {
        if (req.method === 'POST') {
          const origem = req.headers.origin; let ho = null;
          try { ho = origem ? new URL(origem).host : null; } catch { ho = '?'; }
          const permitidos = [req.headers.host, req.headers['x-forwarded-host'], ...(config.origensPermitidas || [])].filter(Boolean);
          if (!String(req.headers['content-type'] || '').startsWith('application/json') || (origem && !permitidos.includes(ho))) return json(res, 403, { erro: 'origem' });
        }
        if (rota === '/convidado.html' || rota === '/convidado.js') return servirArquivo(res, rota);
        if (rota === '/api/convidado/estado' && req.method === 'GET') return json(res, 200, estadoDoConvidado(cv));
        if (rota === '/api/convidado/pedido' && req.method === 'POST') {
          let d; try { d = JSON.parse(await lerCorpo(req, 32 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
          const r = await pedidoDoConvidado(cv, d, ipDe(req)); return json(res, r.erro ? 400 : 200, r);
        }
        if (rota === '/api/convidado/sair' && req.method === 'POST') { convidadosLogados.delete(hashToken(lerCookie(req, 'escritorio_convidado'))); gravarSessoesConvidado(); res.setHeader('Set-Cookie', 'escritorio_convidado=; HttpOnly; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
        if (rota.startsWith('/api/')) return json(res, 403, { erro: 'Convidado só acessa o próprio projeto.' });
        res.writeHead(302, { Location: '/convidado.html' }); return res.end();
      }
    }

    if (!logado(req)) {
      if (rota.startsWith('/api/')) return json(res, 401, { erro: 'login' });
      res.writeHead(302, { Location: '/login.html' });
      return res.end();
    }

    // ações que mudam algo: só JSON e só da própria origem (proteção contra CSRF além do SameSite)
    if (req.method === 'POST') {
      const origem = req.headers.origin;
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { erro: 'tipo' });
      let hostOrigem = null;
      try { hostOrigem = origem ? new URL(origem).host : null; } catch { hostOrigem = '?'; }
      // atrás do `tailscale serve` o Host pode chegar como 127.0.0.1; aceitamos também os endereços do config
      const permitidos = [req.headers.host, req.headers['x-forwarded-host'], ...(config.origensPermitidas || [])].filter(Boolean);
      if (origem && !permitidos.includes(hostOrigem)) return json(res, 403, { erro: 'origem' });
    }

    if (rota === '/api/ordens' && req.method === 'POST') {
      let dados;
      try { dados = JSON.parse(await lerCorpo(req, 160 * 1024 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido ou anexos grandes demais.' }); }
      const r = await novaOrdem(dados, ipDe(req));
      avisar();
      return json(res, r.erro ? 400 : 200, r);
    }
    const corr = rota.match(/^\/api\/ordens\/([0-9a-f]{12})\/corrigir$/);
    if (corr && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 16_384) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await corrigirRumo(corr[1], d.pedido);
      avisar();
      return json(res, r.erro ? 400 : 200, r);
    }
    const parar = rota.match(/^\/api\/ordens\/([0-9a-f]{12})\/parar$/);
    if (parar && req.method === 'POST') {
      const r = await pararOrdem(parar[1]);
      avisar();
      return json(res, r.erro ? 404 : 200, r);
    }
    if (rota === '/api/telegram' && req.method === 'POST') {
      let dados;
      try { dados = JSON.parse(await lerCorpo(req, 4096) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await configurarTelegram(dados);
      avisar();
      return json(res, r.erro ? 400 : 200, r);
    }
    if (rota === '/api/minha-sala' && req.method === 'POST') {
      let dados;
      try { dados = JSON.parse(await lerCorpo(req, 4096) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const cor = /^#[0-9a-f]{6}$/i.test(dados.cor || '') ? dados.cor : '#185FA5';
      config.minhaSala = { nome: String(dados.nome || '').slice(0, 30), cor, planta: !!dados.planta, quadro: String(dados.quadro || '').slice(0, 40) };
      fs.writeFileSync(path.join(DADOS, 'minha-sala.json'), JSON.stringify(config.minhaSala), { mode: 0o600 });
      avisar();
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/agenda' && req.method === 'POST') {
      let dados;
      try { dados = JSON.parse(await lerCorpo(req, 32_768) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await salvarAgendamento(dados);
      return json(res, r.erro ? 400 : 200, r);
    }
    const ag = rota.match(/^\/api\/agenda\/([0-9a-f]{12})\/(apagar|alternar)$/);
    if (ag && req.method === 'POST') {
      const k = agenda.findIndex(a => a.id === ag[1]);
      if (k < 0) return json(res, 404, { erro: 'Não encontrado.' });
      if (ag[2] === 'apagar') agenda.splice(k, 1); else agenda[k].ativo = !agenda[k].ativo;
      gravarAgenda(); avisar();
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/setores' && req.method === 'GET') {
      return json(res, 200, config.setores.filter(s => !config.ocultos.includes(s.id) && pastaDoSetor(s.id)).map(({ id, nome }) => ({ id, nome })));
    }

    // anexos de uma ordem (para as miniaturas no relatório)
    const anexo = rota.match(/^\/api\/anexos\/([0-9a-f]{12})\/([^/]+)$/);
    if (anexo && req.method === 'GET') {
      const nome = decodeURIComponent(anexo[2]);
      if (nome !== path.basename(nome) || !TIPOS_ANEXO.test(nome)) return json(res, 404, { erro: 'anexo' });
      const arq = path.join(DIR_ANEXOS, anexo[1], nome);
      if (!fs.existsSync(arq)) return json(res, 404, { erro: 'anexo' });
      const ext = path.extname(nome).toLowerCase();
      const tipo = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] || 'text/plain; charset=utf-8';
      res.writeHead(200, { 'Content-Type': tipo, 'Content-Disposition': `inline; filename="${nome}"`, 'Cache-Control': 'private, max-age=3600' });
      return fs.createReadStream(arq).pipe(res);
    }

    if (rota === '/api/relatorios' && req.method === 'GET') return json(res, 200, relatorios.filter(r => !r.emRevisao));
    if (rota === '/api/painel' && req.method === 'GET') return json(res, 200, await dadosDoPainel());
    if (rota === '/api/rotinas/resumo/rodar' && req.method === 'POST') { const r = await resumoDaManha('painel'); return json(res, 200, r); }
    if (rota === '/api/financeiro' && req.method === 'GET') return json(res, 200, await dadosFinanceiros());
    if (rota === '/api/financeiro/custos' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 8 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = salvarCusto(d); return json(res, r.erro ? 400 : 200, r);
    }
    const fc = rota.match(/^\/api\/financeiro\/custos\/([0-9a-f]{12})\/apagar$/);
    if (fc && req.method === 'POST') { financeiro.custos = financeiro.custos.filter(c => c.id !== fc[1]); gravarFinanceiro(); cacheFinanceiro.em = 0; avisar(); return json(res, 200, { ok: true }); }
    const dr = rota.match(/^\/api\/departamentos\/([a-z0-9-]{2,30})\/rodar$/);
    if (dr && req.method === 'POST') {
      const r = await Promise.race([rodarDepartamento(dr[1], 'painel').catch(e => ({ erro: e.message })), new Promise(ok => setTimeout(() => ok({ ok: true, mensagem: 'O departamento começou. O relatório chega nas Conversas em alguns minutos.' }), 1500))]);
      return json(res, r.erro ? 400 : 200, r);
    }
    const ml = rota.match(/^\/api\/melhorias\/([0-9a-f]{12})\/(aprovar|recusar)$/);
    if (ml && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 4 * 1024) || '{}'); } catch { d = {}; }
      const r = await decidirMelhoria(ml[1], ml[2] === 'aprovar', d.motivo, ipDe(req)); return json(res, r.erro ? 400 : 200, r);
    }
    const rh = rota.match(/^\/api\/rh\/([0-9a-f]{12})\/(aprovar|recusar)$/);
    if (rh && req.method === 'POST') { const r = decidirContratacao(rh[1], rh[2] === 'aprovar'); return json(res, r.erro ? 400 : 200, r); }
    if (rota === '/api/convites' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 16 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = criarConvite(d); return json(res, r.erro ? 400 : 200, r);
    }
    const cvr = rota.match(/^\/api\/convites\/([0-9a-f]{12})\/(cancelar|permissao|renovar|novo-link|apagar)$/);
    if (cvr && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 16 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = acaoConvite(cvr[1], cvr[2], d); return json(res, r.erro ? 400 : 200, r);
    }
    const cvp = rota.match(/^\/api\/convites\/([0-9a-f]{12})\/pedidos\/([0-9a-f]{12})\/(aprovar|recusar)$/);
    if (cvp && req.method === 'POST') { const r = await decidirPedidoConvidado(cvp[1], cvp[2], cvp[3] === 'aprovar', ipDe(req)); return json(res, r.erro ? 400 : 200, r); }
    if (rota === '/api/reunioes' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 64 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await chamarReuniao(d); return json(res, r.erro ? 400 : 200, r);
    }
    if (rota === '/api/metas' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 64 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = criarMeta(d); return json(res, r.erro ? 400 : 200, r);
    }
    const mt = rota.match(/^\/api\/metas\/([0-9a-f]{12})\/(apagar|concluir|passo|marcar|tirar|mandar)$/);
    if (mt && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 16 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await acaoMeta(mt[1], mt[2], d, ipDe(req)); return json(res, r.erro ? 400 : 200, r);
    }
    if (rota === '/api/publicacoes' && req.method === 'GET') return json(res, 200, { itens: await historicoPublicacoes(), pendentes: deploys.filter(d => d.status === 'aguardando') });
    const volta = rota.match(/^\/api\/publicacoes\/([0-9a-f]{12})\/voltar$/);
    if (volta && req.method === 'POST') { const r = await pedirVolta(volta[1]); return json(res, r.erro ? 400 : 200, r); }
    if (rota === '/api/ideias' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 64 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = salvarIdeia(d);
      return json(res, r.erro ? 400 : 200, r);
    }
    const idA = rota.match(/^\/api\/ideias\/([0-9a-f]{12})\/(mover|apagar|mandar)$/);
    if (idA && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 16 * 1024) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await acaoIdeia(idA[1], idA[2], d, ipDe(req));
      return json(res, r.erro ? 400 : 200, r);
    }
    // busca nas conversas: ignora acentos e maiúsculas; todas as palavras precisam aparecer
    if (rota === '/api/busca' && req.method === 'GET') {
      const norm = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const termos = norm(url.searchParams.get('q')).split(/\s+/).filter(t => t.length >= 2).slice(0, 8);
      if (!termos.length) return json(res, 200, []);
      const achados = [];
      for (const r of relatorios) {
        if (r.emRevisao) continue;
        const campos = { titulo: r.simples?.titulo, pedido: r.pedido, resumo: r.simples?.resumo, resposta: r.resposta, setor: nomeSetor(r.setor), agente: r.agente, arquivos: (r.arquivos || []).join(' ') };
        const tudo = norm(Object.values(campos).join(' \n '));
        if (!termos.every(t => tudo.includes(t))) continue;
        let pontos = 0;
        for (const t of termos) pontos += (norm(campos.titulo).includes(t) ? 5 : 0) + (norm(campos.pedido).includes(t) ? 3 : 0) + (norm(campos.setor).includes(t) ? 2 : 0) + (norm(campos.resumo).includes(t) ? 2 : 0) + 1;
        const texto = String(r.resposta || r.pedido || ''), k = norm(texto).indexOf(termos[0]);
        achados.push({ id: r.id, conversa: r.sessao || r.id, agente: r.agente, setor: r.setor, fim: r.fim, titulo: r.simples?.titulo || curto(semQuebra(r.pedido), 90), pontos,
          trecho: k >= 0 ? curto(semQuebra(texto.slice(Math.max(0, k - 80), k + 160)), 240) : curto(semQuebra(r.simples?.resumo || texto), 240) });
      }
      achados.sort((a, b) => b.pontos - a.pontos || b.fim - a.fim);
      return json(res, 200, achados.slice(0, 40));
    }
    const aval = rota.match(/^\/api\/relatorios\/([0-9a-f-]{36})\/avaliar$/);
    if (aval && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 8192) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await avaliarEntrega(aval[1], d.avaliacao, d.comentario);
      avisar();
      return json(res, r.erro ? 400 : 200, r);
    }
    const dp = rota.match(/^\/api\/deploys\/([0-9a-f]{12})\/(publicar|cancelar)$/);
    if (dp && req.method === 'POST') {
      const r = dp[2] === 'publicar' ? await publicarDeploy(dp[1]) : cancelarDeploy(dp[1]);
      return json(res, r.erro ? 400 : 200, r);
    }
    const pvr = rota.match(/^\/api\/previas\/([0-9a-f]{12})\/encerrar$/);
    if (pvr && req.method === 'POST') {
      const r = await encerrarPrevia(pvr[1]);
      return json(res, r.erro ? 400 : 200, r);
    }
    if (rota === '/api/aprendizado/rodar' && req.method === 'POST') {
      const r = await Promise.race([revisarManuais('painel'), new Promise(ok => setTimeout(() => ok({ ok: true, mensagem: 'Revisando os manuais. As propostas aparecem em alguns minutos.' }), 1500))]);
      return json(res, r.erro ? 400 : 200, r);
    }
    const apr = rota.match(/^\/api\/aprendizado\/([0-9a-f]{12})\/(aprovar|recusar)$/);
    if (apr && req.method === 'POST') {
      const r = decidirProposta(apr[1], apr[2] === 'aprovar');
      return json(res, r.erro ? 400 : 200, r);
    }
    if (rota === '/api/rotinas/estrategia/rodar' && req.method === 'POST') {
      memorandoEstrategico('painel');
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/rotinas/devops/rodar' && req.method === 'POST') {
      rondaDevops('painel');
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/rotinas/po/rodar' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 4096) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      if (!temPO(d.setor)) return json(res, 400, { erro: 'Esse produto não tem PO.' });
      resumoSemanalPO(d.setor, 'painel');
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/projetos' && req.method === 'POST') {
      let d; try { d = JSON.parse(await lerCorpo(req, 32_768) || '{}'); } catch { return json(res, 400, { erro: 'Pedido inválido.' }); }
      const r = await novoProjeto(d);
      return json(res, r.erro ? 400 : 200, r);
    }
    const pj = rota.match(/^\/api\/projetos\/([0-9a-f]{12})\/(aprovar|cancelar)$/);
    if (pj && req.method === 'POST') {
      const p = projetos.find(x => x.id === pj[1]);
      if (!p) return json(res, 404, { erro: 'Projeto não encontrado.' });
      if (pj[2] === 'aprovar') {
        const r = aprovarProjeto(p);
        if (r.erro) { gravarProjetos(); avisar(); return json(res, 400, r); }
      } else {
        p.status = 'cancelado'; p.fim = Date.now();
        for (const t of p.tarefas) if (t.ordem && t.status === 'fazendo') pararOrdem(t.ordem);
      }
      gravarProjetos(); avisar();
      return json(res, 200, { ok: true });
    }
    const refazer = rota.match(/^\/api\/relatorios\/([0-9a-f-]{36})\/resumir$/);
    if (refazer && req.method === 'POST') {
      const rel = relatorios.find(r => r.id === refazer[1]);
      if (!rel) return json(res, 404, { erro: 'Relatório não encontrado.' });
      resumir(rel).catch(e => console.error('resumo:', e.message));
      return json(res, 200, { ok: true });
    }
    const lido = rota.match(/^\/api\/relatorios\/([0-9a-f-]{36}|todos)\/lido$/);
    if (lido && req.method === 'POST') {
      for (const r of relatorios) if (lido[1] === 'todos' || r.id === lido[1]) r.lido = true;
      gravarRelatorios(); avisar();
      return json(res, 200, { ok: true });
    }

    if (rota === '/api/tempo-real') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${foto()}\n\n`);
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }

    if (req.method === 'GET') return servirArquivo(res, rota);
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { erro: 'interno' });
  }
});

servidor.listen(PORTA, HOST, () => console.log(`Escritório em http://${HOST}:${PORTA}`));
