// Página do convidado: acompanha UM projeto e conversa com os agentes dele, conforme a permissão dada pela dona.
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const rotPerm = { ver: 'só acompanhar', aprovar: 'seus pedidos passam por aprovação', direto: 'seus pedidos rodam na hora' };
let estado = null, sessaoAtual = null, assinatura = '';

async function atualizar() {
  try {
    const r = await fetch('/api/convidado/estado');
    if (r.status === 403 || r.redirected || !r.ok) { $('cvProjeto').textContent = 'Seu acesso terminou'; $('cvSub').textContent = 'Peça um novo link para quem te convidou.'; $('cvForm').hidden = true; return; }
    estado = await r.json();
    desenhar();
  } catch { /* tenta de novo */ }
}

function desenhar() {
  const c = estado.convite;
  $('cvCor').style.background = c.cor;
  $('cvProjeto').textContent = c.projeto;
  $('cvSub').textContent = `Escritório ${c.empresa} · olá, ${c.nome}${c.expira ? ' · acesso até ' + hora(c.expira) : ''}`;
  $('cvPermissao').textContent = rotPerm[c.permissao];
  $('cvPermissao').className = 'cv-permissao ' + c.permissao;
  document.title = `${c.projeto} · escritório`;
  $('cvAgentes').innerHTML = estado.agentes.length ? estado.agentes.map(a => `<li${a.meu ? ' class="meu"' : ''}><i class="st ${esc(a.estado)}"></i><div><b>${esc(a.nome)}</b><small>${esc(a.especialidade || 'agente')}${a.meu ? ' · trabalhando para você' : ''}</small>${a.acao ? `<small class="acao">${esc(a.acao)}</small>` : ''}</div></li>`).join('')
    : '<li class="vazio">Ninguém trabalhando agora.</li>';
  $('cvForm').hidden = c.permissao === 'ver';
  $('cvDica').textContent = c.permissao === 'aprovar' ? 'Seu pedido vai para aprovação antes de rodar.' : 'Conversar só responde. Executar mexe no projeto.';

  // linha do tempo: pedidos aguardando, em andamento e entregas
  const itens = [];
  for (const p of estado.pendentes) itens.push({ t: p.criado, html: `<div class="msg voce"><div class="bolha">${esc(p.pedido)}</div><small>você · ${esc(hora(p.criado))}</small></div>
    <div class="msg sistema ${esc(p.status)}">${p.status === 'aguardando' ? 'Esperando aprovação de quem te convidou.' : p.status === 'recusado' ? 'Esse pedido não foi aprovado.' : 'Aprovado: a equipe vai começar.'}</div>` });
  for (const o of estado.andando) itens.push({ t: o.criada, html: `<div class="msg voce"><div class="bolha">${esc(o.pedido)}</div><small>você · ${esc(hora(o.criada))}</small></div>
    <div class="msg agente"><div class="bolha digitando">${o.naFila ? 'na fila, já já começa' : 'a equipe está trabalhando'}<span class="pontos"><i></i><i></i><i></i></span></div></div>` });
  for (const [sessao, lista] of Object.entries(estado.conversas)) for (const e of lista) itens.push({ t: e.t, html: `<div class="msg voce"><div class="bolha">${esc(e.pedido)}</div></div>${bolhaEntrega(e, sessao)}` });
  itens.sort((a, b) => a.t - b.t);
  const sig = JSON.stringify([itens.map(i => i.t), estado.pendentes.map(p => p.status), estado.andando.length]);
  if (sig !== assinatura) {
    assinatura = sig;
    $('cvMensagens').innerHTML = itens.length ? itens.map(i => i.html).join('') : `<div class="cv-vazio"><b>Bem-vindo ao projeto ${esc(c.projeto)}!</b><p>${c.permissao === 'ver' ? 'Aqui você acompanha os agentes trabalhando neste projeto.' : 'Escreva embaixo o que você precisa. Use <b>Conversar</b> para tirar dúvidas sem mexer em nada, ou <b>Executar</b> para a equipe fazer.'}</p></div>`;
    $('cvMensagens').scrollTop = $('cvMensagens').scrollHeight;
  }
  $('cvRespondendo').hidden = !sessaoAtual;
  if (sessaoAtual) $('cvRespondendo').querySelector('span').textContent = 'Continuando a conversa anterior';
}

function bolhaEntrega(e, sessao) {
  const s = e.simples;
  const corpo = s ? `<b class="tit">${esc(s.titulo)}</b><p>${esc(s.resumo)}</p>
      ${s.resultado?.texto ? `<p class="res ${esc(s.resultado.status)}">${esc(s.resultado.texto)}</p>` : ''}
      ${s.feito?.length ? `<div class="secao"><span class="rot">O que foi feito</span><ul>${s.feito.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${s.proximos?.length ? `<div class="secao"><span class="rot">Próximos passos</span><ul>${s.proximos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${s.pergunta ? `<div class="pergunta"><b>Pergunta para você</b><p>${esc(s.pergunta)}</p></div>` : ''}`
    : `<p style="white-space:pre-wrap">${esc(e.resposta)}</p>`;
  const podeResponder = estado.convite.permissao !== 'ver';
  return `<div class="msg agente"><div class="bolha">${corpo}${podeResponder ? `<button class="cv-responder" data-sessao="${esc(sessao)}">Responder nesta conversa</button>` : ''}</div><small>${esc(e.agente)} · ${esc(hora(e.t))}</small></div>`;
}

$('cvMensagens').addEventListener('click', e => {
  const b = e.target.closest('[data-sessao]');
  if (!b) return;
  sessaoAtual = b.dataset.sessao;
  desenhar(); $('cvTexto').focus();
});
$('cvNovaConversa').onclick = () => { sessaoAtual = null; desenhar(); };
$('cvTexto').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 220) + 'px'; });
$('cvForm').addEventListener('submit', async e => {
  e.preventDefault();
  const texto = $('cvTexto').value.trim();
  if (!texto) return $('cvTexto').focus();
  const botoes = $('cvForm').querySelectorAll('button[type="submit"]');
  botoes.forEach(b => { b.disabled = true; });
  const r = await fetch('/api/convidado/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido: texto, modo: e.submitter?.value === 'conversa' ? 'conversa' : 'executar', sessao: sessaoAtual }) });
  const j = await r.json().catch(() => ({}));
  botoes.forEach(b => { b.disabled = false; });
  if (!r.ok) { $('cvErro').textContent = j.erro || 'Não deu para mandar.'; return; }
  $('cvErro').textContent = ''; $('cvTexto').value = ''; $('cvTexto').style.height = 'auto';
  atualizar();
});
$('cvSair').onclick = async () => { await fetch('/api/convidado/sair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.reload(); };

atualizar();
setInterval(atualizar, 4000);
