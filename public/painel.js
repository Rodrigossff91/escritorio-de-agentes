// Painel lateral: puxe pela aba na esquerda. Visão geral com gráficos, planejamento, equipe e infra.
// Usa o estado ao vivo do escritório (ultimo) e /api/painel para o histórico.
(() => {
  const el = document.createElement('aside');
  el.className = 'gaveta';
  el.id = 'gaveta';
  el.setAttribute('aria-label', 'Painel');
  el.innerHTML = `<button class="puxador" id="puxador" aria-expanded="false" aria-controls="gaveta" title="Puxe ou clique para abrir o painel (atalho: P)"><span>Painel</span></button>
    <div class="gaveta-corpo">
      <header class="gaveta-topo">
        <div class="gaveta-titulo"><h2>Painel</h2><span class="ao-vivo" id="aoVivoG">ao vivo</span>
          <button class="ampliar-gaveta" data-acao="ampliar-gaveta" title="Ampliar o painel" aria-label="Ampliar o painel">⤢</button>
          <button class="fechar-gaveta" data-acao="fechar-gaveta" aria-label="Fechar painel">×</button></div>
        <form class="pedido-rapido" id="pedidoRapido" autocomplete="off">
          <select id="prSetor" aria-label="Projeto"></select>
          <input id="prTexto" maxlength="4000" placeholder="Peça algo para a equipe ou anote uma ideia…" aria-label="Pedido">
          <button type="submit" name="acao" value="ideia" class="pr-ideia" title="Guarda na lista de ideias, sem mandar agora">Guardar ideia</button>
          <button type="submit" name="acao" value="mandar" class="pr-mandar">Mandar</button>
        </form>
      </header>
      <div class="gaveta-meio"><nav class="trilho" role="tablist" aria-label="Seções do painel" id="trilho"></nav><div class="gaveta-conteudo" id="gavetaConteudo"></div></div>
    </div>`;
  document.querySelector('.palco').appendChild(el);
  // ícones de traço simples (24x24)
  const ICONES = {
    geral: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    plano: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 15l2.5 2.5L16 13"/>',
    projetos: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    empresa: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>',
    financeiro: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3.1-1.6M12 6v2M12 16v2"/>',
    publicacoes: '<path d="M12 15V3M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.4.2 4 1.8 4.5 4.5"/>',
    infra: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
    atividade: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.5a2.7 2.7 0 1 1 4.6 2c-.6.6-1.4 1-1.9 1.6-.3.3-.4.7-.4 1.1"/><path d="M12 17.3h.01"/>',
  };
  const SECOES = [['geral', 'Geral'], ['atividade', 'Atividade'], null, ['plano', 'Plano'], ['projetos', 'Projetos'], ['publicacoes', 'Publicar'], null, ['empresa', 'Empresa'], ['financeiro', 'Finanças'], ['equipe', 'Equipe'], null, ['infra', 'Infra'], ['ajuda', 'Ajuda']];
  el.querySelector('#trilho').innerHTML = SECOES.map(x => x ? `<button role="tab" data-aba="${x[0]}" title="${x[1]}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[x[0]]}</svg><span>${x[1]}</span></button>` : '<hr>').join('');
  try { if (localStorage.getItem('painel-largo') === '1') el.classList.add('larga'); } catch { /* ignora */ }

  let timerEntrada = null, ultimoHtml = '', ultimaAba = '';
  let aberta = false, aba = 'geral', dados = null, buscando = false, filtroEquipe = '', filtroAtiv = 'tudo', filtroTextoAtiv = '';
  let pubs = null, filtroPub = 'todos', buscandoPub = false, fin = null, buscandoFin = false;
  let favoritos = new Set();
  try { favoritos = new Set(JSON.parse(localStorage.getItem('escritorio-favoritos') || '[]')); } catch { /* sem armazenamento */ }
  async function buscarFin(forcar) {
    if (buscandoFin || (!forcar && fin && Date.now() - fin.recebido < 60_000)) return;
    buscandoFin = true;
    try { const r = await fetch('/api/financeiro'); if (r.ok) { fin = await r.json(); fin.recebido = Date.now(); if (aberta && aba === 'financeiro') desenhar(); } } catch { /* tenta depois */ }
    buscandoFin = false;
  }
  const rascunhos = {}, detAbertos = new Set();
  el.addEventListener('toggle', e => { const k = e.target.dataset?.det; if (k) { if (e.target.open) detAbertos.add(k); else detAbertos.delete(k); } }, true);
  async function buscarPub() {
    if (buscandoPub) return;
    buscandoPub = true;
    try { const r = await fetch('/api/publicacoes'); if (r.ok) { pubs = await r.json(); if (aberta && aba === 'publicacoes') desenhar(); } } catch { /* tenta de novo */ }
    buscandoPub = false;
  }
  try { aba = localStorage.getItem('painel-aba') || 'geral'; } catch { /* sem armazenamento */ }
  const conteudo = el.querySelector('#gavetaConteudo'), puxador = el.querySelector('#puxador');

  // ---------- abrir, fechar e puxar ----------
  function abrir(sim) {
    aberta = sim;
    el.classList.toggle('aberta', sim);
    el.style.removeProperty('--arraste');
    puxador.setAttribute('aria-expanded', String(sim));
    if (sim) { buscar(); desenhar(); carregarSetores(); if (aba === 'publicacoes') buscarPub(); }
  }
  window.abrirPainel = (qual) => { if (qual) aba = qual; abrir(true); };
  let arrasto = null;
  puxador.addEventListener('pointerdown', e => {
    arrasto = { x: e.clientX, inicio: aberta, mexeu: false, largura: el.querySelector('.gaveta-corpo').offsetWidth };
    puxador.setPointerCapture(e.pointerId);
    el.classList.add('arrastando');
  });
  puxador.addEventListener('pointermove', e => {
    if (!arrasto) return;
    const dx = e.clientX - arrasto.x;
    if (Math.abs(dx) > 4) arrasto.mexeu = true;
    const base = arrasto.inicio ? 0 : arrasto.largura;
    el.style.setProperty('--arraste', Math.max(0, Math.min(arrasto.largura, base + dx)) + 'px');
  });
  const soltar = e => {
    if (!arrasto) return;
    el.classList.remove('arrastando');
    const dx = e.clientX - arrasto.x, a = arrasto;
    arrasto = null;
    if (!a.mexeu) return abrir(!aberta);
    abrir(a.inicio ? dx < a.largura / 4 : dx < -a.largura / 4);
  };
  puxador.addEventListener('pointerup', soltar);
  puxador.addEventListener('pointercancel', soltar);
  addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'p' || e.key === 'P') abrir(!aberta);
    if (e.key === 'Escape' && aberta && !papeladaAberta && !extraAberto && $('ordem').hidden) abrir(false);
  });

  el.addEventListener('click', e => {
    const t = e.target.closest('[data-aba]');
    if (t) { aba = t.dataset.aba; try { localStorage.setItem('painel-aba', aba); } catch { /* ignora */ } if (aba === 'publicacoes') buscarPub(); desenhar(); conteudo.scrollTop = 0; conteudo.classList.remove('entrando'); void conteudo.offsetWidth; conteudo.classList.add('entrando'); clearTimeout(timerEntrada); timerEntrada = setTimeout(() => conteudo.classList.remove('entrando'), 450); return; }
    if (e.target.closest('[data-acao="fechar-gaveta"]')) return abrir(false);
    if (e.target.closest('[data-acao="ampliar-gaveta"]')) { el.classList.toggle('larga'); try { localStorage.setItem('painel-largo', el.classList.contains('larga') ? '1' : '0'); } catch { /* ignora */ } return; }
    const conv = e.target.closest('[data-conversar]');
    if (conv) { const a = avatares.get('fixo:' + conv.dataset.conversar); if (a) { abrir(false); abrirChatAgente(a); } return; }
    const ag = e.target.closest('[data-agente]');
    if (ag) {
      const a = avatares.get(ag.dataset.agente);
      abrir(false);
      if (a) abrirChatAgente(a); else abrirPapelada(ag.dataset.agente); // agente já foi embora: abre a conversa na papelada
      return;
    }
    const pp = e.target.closest('[data-pedir]');
    if (pp) { const sel = el.querySelector('#prSetor'); if (sel) sel.value = pp.dataset.pedir; el.querySelector('#prTexto').focus(); return; }
    const fv = e.target.closest('[data-favorito]');
    if (fv) {
      const id = fv.dataset.favorito;
      favoritos.has(id) ? favoritos.delete(id) : favoritos.add(id);
      try { localStorage.setItem('escritorio-favoritos', JSON.stringify([...favoritos])); } catch { /* ignora */ }
      desenhar();
      return;
    }
    const ex = e.target.closest('[data-extra]');
    if (ex) { abrir(false); abrirExtra(ex.dataset.extra); }
  });
  let setoresLista = null;
  async function carregarSetores() {
    if (!setoresLista) { try { const r = await fetch('/api/setores'); setoresLista = r.ok ? await r.json() : []; } catch { setoresLista = []; } }
    const sel = el.querySelector('#prSetor');
    if (sel && !sel.options.length) {
      sel.innerHTML = setoresLista.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
      try { const ult = localStorage.getItem('painel-setor'); if (ult && setoresLista.some(x => x.id === ult)) sel.value = ult; } catch { /* ignora */ }
    }
  }
  const contaPadrao = () => { try { return localStorage.getItem('escritorio-conta') || 'pessoal'; } catch { return 'pessoal'; } };
  el.querySelector('#pedidoRapido').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget, texto = f.querySelector('#prTexto').value.trim(), setor = f.querySelector('#prSetor').value;
    const acao = e.submitter?.value === 'ideia' ? 'ideia' : 'mandar';
    if (!texto) { f.querySelector('#prTexto').focus(); return; }
    try { localStorage.setItem('painel-setor', setor); } catch { /* ignora */ }
    f.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const r = acao === 'ideia'
      ? await postar('/api/ideias', { titulo: texto, setor })
      : await postar('/api/ordens', { setor, pedido: texto, conta: contaPadrao(), modo: 'executar' });
    const j = await r.json().catch(() => ({}));
    f.querySelectorAll('button').forEach(b => { b.disabled = false; });
    if (!r.ok) { aviso(j.erro || 'Não deu para mandar.', null, [330]); return; }
    f.querySelector('#prTexto').value = '';
    aviso(acao === 'ideia' ? 'Ideia guardada. Ela fica em Planejamento › Ideias.' : 'Pedido enviado. O escritório escolhe o especialista certo.', null, [523, 659]);
    if (acao === 'ideia') { aba = 'plano'; desenhar(); }
  });
  el.addEventListener('submit', async e => {
    const f = e.target;
    if (f.matches('form.resp-rapida')) {
      e.preventDefault();
      const txt = f.querySelector('input').value.trim();
      if (!txt) return f.querySelector('input').focus();
      f.querySelectorAll('button').forEach(b => { b.disabled = true; });
      const r = await postar('/api/ordens', { sessao: f.dataset.sessao, pedido: txt, modo: e.submitter?.value === 'conversa' ? 'conversa' : 'executar' });
      const j = await r.json().catch(() => ({}));
      f.querySelectorAll('button').forEach(b => { b.disabled = false; });
      if (!r.ok) return aviso(j.erro || 'Não deu para responder.', null, [330]);
      delete rascunhos['resp:' + f.dataset.sessao];
      aviso('Resposta enviada. Ele continua de onde parou.', null, [523, 659]);
      return;
    }
    if (f.matches('form.nova-meta')) {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const r = await postar('/api/metas', d), j = await r.json().catch(() => ({}));
      if (!r.ok) return aviso(j.erro || 'Não deu para criar a meta.', null, [330]);
      ['meta:titulo', 'meta:prazo', 'meta:passos'].forEach(k => delete rascunhos[k]);
      detAbertos.delete('nova-meta'); aviso('Meta criada.', null, [523, 784]);
      return;
    }
    if (f.matches('form.decidir-cresc')) {
      e.preventDefault();
      const aprovar = e.submitter?.value === 'aprovar';
      f.querySelectorAll('button').forEach(x => { x.disabled = true; });
      const r = await postar(`/api/melhorias/${f.dataset.id}/${aprovar ? 'aprovar' : 'recusar'}`, { motivo: f.motivo.value }), j = await r.json().catch(() => ({}));
      if (!r.ok) { f.querySelectorAll('button').forEach(x => { x.disabled = false; }); return aviso(j.erro || 'Não deu.', null, [330]); }
      delete rascunhos['cresc:' + f.dataset.id];
      aviso(aprovar ? 'Aprovado! O setor de Crescimento começou a construir. Quando terminar, aparece para você Publicar.' : 'Recusada. O setor vai levar isso em conta nas próximas ideias.', null, aprovar ? [523, 659, 784] : [330]);
      return;
    }
    if (f.matches('form.novo-custo')) {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const r = await postar('/api/financeiro/custos', d), j = await r.json().catch(() => ({}));
      if (!r.ok) return aviso(j.erro || 'Não deu para salvar.', null, [330]);
      ['custo:nome', 'custo:valor'].forEach(k => delete rascunhos[k]);
      aviso('Custo cadastrado.'); buscarFin(true); return;
    }
    if (f.matches('form.nova-reuniao')) {
      e.preventDefault();
      const participantes = [...f.querySelectorAll('input[name="p"]:checked')].map(x => x.value);
      const b = f.querySelector('button[type="submit"]'); b.disabled = true;
      const r = await postar('/api/reunioes', { tema: f.tema.value, setor: f.setor.value, participantes, conta: contaPadrao() }), j = await r.json().catch(() => ({}));
      b.disabled = false;
      if (!r.ok) return aviso(j.erro || 'Não deu para chamar a reunião.', null, [330]);
      delete rascunhos['reu:tema']; delete rascunhos['reu:sel'];
      aviso('Reunião chamada. Eles estão indo para a sala de reunião. Leva alguns minutos.', null, [523, 659, 784]);
      return;
    }
    if (f.matches('form.novo-passo')) {
      e.preventDefault();
      const inp = f.querySelector('input'), texto = inp.value.trim();
      if (!texto) return inp.focus();
      const r = await postar(`/api/metas/${f.dataset.meta}/passo`, { texto }), j = await r.json().catch(() => ({}));
      if (!r.ok) return aviso(j.erro || 'Não deu.', null, [330]);
      delete rascunhos['passo:' + f.dataset.meta];
    }
  });
  el.addEventListener('click', async e => {
    const dr = e.target.closest('[data-dep-rodar]');
    if (dr) { dr.disabled = true; const r = await postar(`/api/departamentos/${dr.dataset.depRodar}/rodar`), j = await r.json().catch(() => ({})); aviso(r.ok ? (j.mensagem || 'Pronto. O relatório chegou nas Conversas.') : (j.erro || 'Não deu.'), null, r.ok ? [523, 659] : [330]); return; }
    const dv = e.target.closest('[data-dep-ver]');
    if (dv) { abrir(false); abrirPapelada('dep-' + dv.dataset.depVer); return; }
    const ds = e.target.closest('[data-dep-sala]');
    if (ds) { const s2 = salas.get('dep-' + ds.dataset.depSala); if (s2) { vista.alvoFoco.set(s2.cx, 0, s2.cz); vista.alvoZoom = 3; } abrir(false); return; }
    const rh = e.target.closest('[data-rh]');
    if (rh) { const [id, acao] = rh.dataset.rh.split(':'); rh.disabled = true; const r = await postar(`/api/rh/${id}/${acao}`), j = await r.json().catch(() => ({})); aviso(r.ok ? (acao === 'aprovar' ? 'Contratado! O novo especialista já faz parte da equipe.' : 'Proposta recusada.') : (j.erro || 'Não deu.'), null, r.ok ? [523, 659, 784] : [330]); return; }
    const wa = e.target.closest('[data-wa-auto]');
    if (wa) { await postar('/api/whatsapp/auto', { ativo: wa.checked }); aviso(wa.checked ? 'Ligado: o agente do WhatsApp reinicia sozinho quando um número travar.' : 'Desligado: quando travar, você só recebe o aviso.'); return; }
    const ca = e.target.closest('[data-custo-apagar]');
    if (ca) { if (!ca.classList.contains('confirmar')) { ca.classList.add('confirmar'); ca.textContent = 'Apagar?'; return; } await postar(`/api/financeiro/custos/${ca.dataset.custoApagar}/apagar`); buscarFin(true); return; }
    const mb = e.target.closest('[data-meta]');
    if (mb) {
      const [id, acao, passo] = mb.dataset.meta.split(':');
      if (['apagar', 'tirar'].includes(acao) && !mb.classList.contains('confirmar')) { mb.classList.add('confirmar'); mb.textContent = acao === 'apagar' ? 'Apagar a meta?' : 'Tirar?'; return; }
      mb.disabled = true;
      const r = await postar(`/api/metas/${id}/${acao}`, { passo, conta: contaPadrao() }), j = await r.json().catch(() => ({}));
      mb.disabled = false;
      if (!r.ok) aviso(j.erro || 'Não deu.', null, [330]);
      else if (acao === 'mandar') aviso('Passo mandado para a equipe. Quando entregar, ele é marcado como feito sozinho.', null, [523, 659, 784]);
      return;
    }
    if (e.target.closest('[data-resumo-agora]')) {
      const b = e.target.closest('[data-resumo-agora]'); b.disabled = true;
      await postar('/api/rotinas/resumo/rodar'); b.disabled = false;
      abrir(false); abrirPapelada('resumo-da-manha'); return;
    }
    const v = e.target.closest('[data-voltar]');
    if (v) {
      if (!v.classList.contains('confirmar')) { v.classList.add('confirmar'); v.textContent = 'Confirmar: criar pedido de volta?'; return; }
      v.disabled = true;
      const r = await postar(`/api/publicacoes/${v.dataset.voltar}/voltar`), j = await r.json().catch(() => ({}));
      aviso(r.ok ? 'Pedido de volta criado. Ele só acontece quando você apertar Publicar (lá em cima nesta aba).' : (j.erro || 'Não deu.'), null, r.ok ? [523, 659] : [330]);
      buscarPub(); return;
    }
    const pb = e.target.closest('[data-pub-publicar]');
    if (pb) {
      if (!pb.classList.contains('confirmar')) { pb.classList.add('confirmar'); pb.textContent = 'Confirmar publicação'; return; }
      pb.disabled = true;
      const r = await postar(`/api/deploys/${pb.dataset.pubPublicar}/publicar`), j = await r.json().catch(() => ({}));
      aviso(r.ok ? 'Autorizado. O DevOps confere tudo, publica e te conta quando estiver no ar.' : (j.erro || 'Não deu.'), null, r.ok ? [523, 659, 784] : [330]);
      buscarPub(); return;
    }
    const pc = e.target.closest('[data-pub-cancelar]');
    if (pc) { pc.disabled = true; await postar(`/api/deploys/${pc.dataset.pubCancelar}/cancelar`); aviso('Pedido cancelado.'); buscarPub(); return; }
    const b = e.target.closest('[data-ideia]');
    if (!b) return;
    const [id, acao, valor] = b.dataset.ideia.split(':');
    if (acao === 'apagar' && !b.classList.contains('confirmar')) { b.classList.add('confirmar'); b.textContent = 'Apagar mesmo?'; return; }
    b.disabled = true;
    const corpo = acao === 'mandar' ? { conta: contaPadrao(), modo: 'executar' } : acao === 'mover' ? (PRIOS.includes(valor) ? { prioridade: valor } : { status: valor }) : {};
    const r = await postar(`/api/ideias/${id}/${acao}`, corpo);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { b.disabled = false; aviso(j.erro || 'Não deu certo.', null, [330]); return; }
    if (acao === 'mandar') aviso('Ideia mandada para a equipe. Acompanhe em Fazendo.', null, [523, 659, 784]);
  });
  const PRIOS = ['alta', 'media', 'baixa'];
  el.querySelectorAll('.trilho').forEach(n => n.addEventListener('keydown', ev => {
    if (!['ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault();
    const bs = [...n.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    const prox = bs[(i + (ev.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length];
    prox.focus(); prox.click();
  }));
  el.addEventListener('input', e => {
    const kr = e.target.dataset?.rascunho;
    if (kr) rascunhos[kr] = e.target.value;
    if (e.target.id === 'filtroEquipe') { filtroEquipe = e.target.value; desenharEquipeLista(); }
    if (e.target.id === 'filtroTextoAtiv') { filtroTextoAtiv = e.target.value; desenharAtividadeLista(); }
    if (e.target.name === 'filtroAtiv') { filtroAtiv = e.target.value; desenhar(); }
    if (e.target.name === 'filtroPub') { filtroPub = e.target.value; desenhar(); }
    if (e.target.name === 'p' && e.target.closest('form.nova-reuniao')) {
      const marcados = [...e.target.form.querySelectorAll('input[name="p"]:checked')].map(x => x.value);
      if (marcados.length > 3) { e.target.checked = false; aviso('No máximo 3 especialistas por reunião.'); return; }
      rascunhos['reu:sel'] = marcados; e.target.closest('label').classList.toggle('marcado', e.target.checked);
    }
  });

  async function buscar() {
    if (buscando) return;
    buscando = true;
    try { const r = await fetch('/api/painel'); if (r.ok) { dados = await r.json(); if (aberta) desenhar(); } } catch { /* tenta na próxima */ }
    buscando = false;
  }
  setInterval(() => { if (aberta) buscar(); if (aberta && aba === 'publicacoes') buscarPub(); }, 60_000);
  // o escritório chama isto a cada atualização ao vivo
  window.painelAtualizar = () => { if (aberta) desenhar(); };

  // ---------- utilidades ----------
  const brl = usd => dados?.brl ? (usd * dados.brl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : 'US$ ' + usd.toFixed(0);
  const quando = ms => {
    if (!ms) return 'nunca';
    const m = Math.round((Date.now() - ms) / 60_000);
    if (m < 1) return 'agora';
    if (m < 60) return `há ${m} min`;
    if (m < 1440) return `há ${Math.round(m / 60)} h`;
    return `há ${Math.round(m / 1440)} d`;
  };
  const corSetor = id => (ultimo?.setores || []).find(x => x.id === id)?.cor || '#888780';
  const nomeSala = id => (ultimo?.setores || []).find(x => x.id === id)?.nome || id;
  const diaCurto = d => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };

  // barras empilhadas por dia, cores por projeto
  function graficoDias() {
    if (!dados) return carregando();
    const dias = dados.dias, top = dados.porSetor.slice(0, 5).map(x => x.setor);
    const maior = Math.max(1, ...dias.map(d => dados.porDia[d].total));
    const W = 520, H = 170, esq = 28, base = H - 22, larg = (W - esq) / dias.length, alt = base - 10;
    const bruto = maior / 4, mag = 10 ** Math.floor(Math.log10(bruto || 1));
    const passo = maior <= 4 ? 1 : [1, 2, 5, 10].map(f => f * mag).find(v => v >= bruto);
    const max = Math.ceil(maior / passo) * passo;
    let grade = '';
    for (let v = 0; v <= max; v += passo) {
      const y = base - v / max * alt;
      grade += `<line x1="${esq}" x2="${W}" y1="${y}" y2="${y}" class="grade"/><text x="${esq - 6}" y="${y + 4}" class="eixo" text-anchor="end">${v}</text>`;
    }
    const barras = dias.map((d, i) => {
      const pd = dados.porDia[d], x = esq + i * larg + larg * 0.18, w = larg * 0.64;
      let y = base, partes = '';
      const fatias = [...top.map(s => [s, pd.setores[s] || 0]), ['outros', pd.total - top.reduce((a, s) => a + (pd.setores[s] || 0), 0)]];
      for (const [s, n] of fatias) {
        if (!n) continue;
        const h = n / max * alt;
        y -= h;
        partes += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(h - 1, 1)}" rx="3" fill="${s === 'outros' ? 'var(--g-outros)' : corSetor(s)}"><title>${esc(diaCurto(d))} · ${esc(s === 'outros' ? 'outros' : nomeSala(s))}: ${n}</title></rect>`;
      }
      const rotulo = i % 2 === dias.length % 2 || i === dias.length - 1 ? `<text x="${x + w / 2}" y="${H - 6}" class="eixo" text-anchor="middle">${i === dias.length - 1 ? 'hoje' : diaCurto(d)}</text>` : '';
      return partes + rotulo;
    }).join('');
    const legenda = [...top.map(s => `<li><i style="background:${corSetor(s)}"></i>${esc(nomeSala(s))}</li>`), `<li><i style="background:var(--g-outros)"></i>outros</li>`].join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Tarefas entregues por dia nos últimos 14 dias">${grade}${barras}</svg><ul class="legenda-g">${legenda}</ul>`;
  }
  // linha: agentes trabalhando nas últimas 3 horas (minuto a minuto)
  function graficoAoVivo() {
    const pts = (ultimo?.aoVivo || []).slice(-180);
    if (pts.length < 2) return `<p class="vazio-g">O gráfico aparece depois de alguns minutos de escritório aberto.</p>`;
    const W = 520, H = 110, base = H - 18, max = Math.max(2, ...pts.map(p => p.trabalhando + p.esperando));
    const x = i => i / (pts.length - 1) * W, y = v => base - v / max * (base - 8);
    const linha = k => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const area = `${linha('trabalhando')}L${W},${base}L0,${base}Z`;
    const ult = pts.at(-1);
    return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Agentes trabalhando e esperando nas últimas horas">
      <defs><linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--destaque)" stop-opacity=".28"/><stop offset="1" stop-color="var(--destaque)" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="grade"/>
      <path d="${area}" class="area"/><path d="${linha('trabalhando')}" class="linha"/><path d="${linha('esperando')}" class="linha aviso"/>
      <circle cx="${W}" cy="${y(ult.trabalhando)}" r="3.5" class="ponto"/>
      <text x="0" y="${H - 3}" class="eixo">${esc(new Date(pts[0].t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</text>
      <text x="${W}" y="${H - 3}" class="eixo" text-anchor="end">agora</text></svg>
      <ul class="legenda-g"><li><i style="background:var(--destaque)"></i>trabalhando</li><li><i style="background:var(--aviso)"></i>esperando você</li></ul>`;
  }
  // barras horizontais
  const barrasH = (itens, valor, rotulo, cor, extra) => {
    const max = Math.max(1, ...itens.map(valor));
    return `<ul class="barras-h">${itens.map(it => `<li><span class="bh-nome">${esc(rotulo(it))}</span>
      <span class="bh-trilho"><span class="bh-barra" style="width:${Math.max(2, valor(it) / max * 100)}%;background:${cor(it)}"></span></span>
      <span class="bh-valor">${esc(extra(it))}</span></li>`).join('')}</ul>`;
  };
  // linha fina de 7 dias para métricas do servidor
  function sparkline(k, limite) {
    const m = dados?.metricas || [];
    if (m.length < 2) return `<span class="vazio-g">coletando (a cada 15 min)</span>`;
    const W = 200, H = 40, x = i => i / (m.length - 1) * W, y = v => H - 3 - v / 100 * (H - 6);
    const d = m.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none" aria-hidden="true">
      ${limite ? `<line x1="0" x2="${W}" y1="${y(limite)}" y2="${y(limite)}" class="grade limite"/>` : ''}
      <path d="${d}L${W},${H}L0,${H}Z" class="area"/><path d="${d}" class="linha"/></svg>`;
  }
  const carregando = () => `<div class="esqueleto" aria-label="Carregando"><i></i><i></i><i></i></div>`;
  const kpi = (valor, rotulo, tom, acao, extra) => `<div class="kpi ${tom || ''}" ${acao || ''}><b>${valor}</b><span>${rotulo}</span>${extra || ''}</div>`;
  const delta = (agora, antes, rot) => { if (antes == null) return ''; const d = agora - antes; return `<em class="delta ${d > 0 ? 'sobe' : d < 0 ? 'desce' : ''}">${d > 0 ? '+' : ''}${d} ${rot}</em>`; };
  const miniLinha = (pts, k) => { if (pts.length < 2) return ''; const max = Math.max(1, ...pts.map(p => p[k])); return `<svg class="mini-linha" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * 100).toFixed(1)},${(22 - p[k] / max * 20).toFixed(1)}`).join('')}"/></svg>`; };

  // ---------- abas ----------
  function geral() {
    const ags = ultimo?.agentes || [], trab = ags.filter(a => a.estado === 'trabalhando').length, esp = ags.filter(a => a.estado === 'esperando').length;
    const incs = (ultimo?.incidentes || []).filter(i => i.status === 'aberto').length;
    const t = dados?.totais;
    const rm = ultimo?.rotinas?.config?.resumoManha;
    const dias = dados?.dias || [], ontemN = dias.length > 1 ? dados.porDia[dias.at(-2)]?.total : null;
    const vivo = (ultimo?.aoVivo || []).slice(-60);
    return `${rm?.ativo !== false ? `<div class="resumo-manha largo"><div><b>Resumo da manhã</b><small>Todo dia às ${esc(rm?.hora || '08:00')}: ontem, o que espera você, saúde e plano do dia.</small></div><button data-resumo-agora>Ver agora</button></div>` : ''}
      <div class="kpis largo">
        ${kpi(trab, 'trabalhando agora', trab ? 'bom' : '', '', miniLinha(vivo, 'trabalhando'))}
        ${kpi(esp, 'esperando você', esp ? 'aviso' : '')}
        ${kpi(t ? t.hoje : '–', 'entregas hoje', '', '', ontemN != null ? `<em class="delta">ontem: ${ontemN}</em>` : '')}
        ${kpi(t ? t.semana : '–', 'entregas na semana')}
        ${kpi(incs, 'incidentes abertos', incs ? 'ruim' : 'bom', 'data-extra="sala"')}
        ${kpi(t ? brl(t.usdMes) : '–', 'equivalente em 30 dias', '', 'data-extra="consumo"')}
      </div>
      <section class="bloco"><h3>Entregas por dia</h3><p class="sub">Últimos 14 dias, separadas por projeto.</p>${graficoDias()}</section>
      <section class="bloco"><h3>Agora no escritório</h3><p class="sub">Agentes trabalhando e esperando nas últimas horas.</p>${graficoAoVivo()}</section>
      <section class="bloco"><h3>Projetos mais ativos</h3><p class="sub">Entregas nos últimos 30 dias.</p>
        ${dados ? (dados.porSetor.length ? barrasH(dados.porSetor.slice(0, 8), x => x.tarefas, x => x.nome, x => corSetor(x.setor), x => `${x.tarefas} · ${x.semana} na semana`) : '<p class="vazio-g">Nenhuma entrega ainda.</p>') : carregando()}</section>
      ${t && t.revisados ? `<section class="bloco"><h3>Qualidade</h3><p class="sub">O QA revisou ${t.revisados} entregas em 30 dias e aprovou de primeira ${t.aprovacaoQA}%.</p>
        <div class="medidor"><span style="width:${t.aprovacaoQA}%"></span></div></section>` : ''}
      <p class="rodape-g">O custo é o equivalente na API, só de referência: o escritório usa a sua assinatura, sem cobrança extra.</p>`;
  }

  function proximosEventos() {
    const rc = ultimo?.rotinas?.config || {}, ev = [], agora = new Date();
    const hm = h => String(h || '00:00').split(':').map(Number);
    for (let k = 0; k < 7; k++) {
      const d = new Date(agora); d.setDate(d.getDate() + k);
      const em = (hora, titulo, quem, tipo) => { const [h, m] = hm(hora); const t = new Date(d); t.setHours(h, m, 0, 0); if (t > agora) ev.push({ t, titulo, quem, tipo }); };
      if (rc.devops?.ativo !== false) em(rc.devops?.hora || '07:00', 'Ronda da produção', 'DevOps', 'rotina');
      if (rc.resumoManha?.ativo !== false) em(rc.resumoManha?.hora || '08:00', 'Resumo da manhã para você', 'Escritório', 'rotina');
      for (const dp of ultimo?.departamentos || []) { const r = dp.rotina; if (r?.ativo && (r.freq === 'mensal' ? d.getDate() === r.dia : d.getDay() === r.dia)) em(r.hora, `Rotina de ${dp.nome}`, dp.nome, 'rotina'); }
      if (rc.poSemanal?.ativo !== false && d.getDay() === (rc.poSemanal?.dia ?? 1)) for (const po of ultimo?.pos || []) em(rc.poSemanal?.hora || '08:00', `Resumo semanal · ${nomeSala(po.setor)}`, po.nome, 'rotina');
      if (rc.estrategiaMensal?.ativo !== false && d.getDate() === (rc.estrategiaMensal?.diaDoMes || 1)) em(rc.estrategiaMensal?.hora || '09:00', 'Memorando estratégico', 'Estrategista', 'rotina');
      if (rc.aprendizado?.ativo && d.getDay() === rc.aprendizado.dia) em(rc.aprendizado.hora || '17:00', 'Revisão dos manuais (melhorias da equipe)', 'Equipe', 'rotina');
      for (const a of ultimo?.agenda || []) {
        if (a.ativo === false) continue;
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if ((a.repetir === 'uma-vez' && a.data === ymd) || a.repetir === 'diario' || (a.repetir !== 'uma-vez' && a.repetir !== 'diario' && (a.dias || []).includes(d.getDay())))
          em(a.hora, a.pedido || 'Tarefa agendada', nomeSala(a.setor), 'agenda');
      }
    }
    return ev.sort((a, b) => a.t - b.t).slice(0, 14);
  }
  function cartao(titulo, sub, cor, attrs) {
    return `<div class="cartao-k" ${attrs || ''}><i style="background:${cor}"></i><div><b>${esc(titulo)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
  }
  // coluna do kanban (id opcional: dá para achar e atualizar só ela quando um dado chega depois)
  const col = (titulo, n, itens, vazio, id) => `<div class="coluna-k"${id ? ` id="${id}"` : ''}><h4>${titulo}<span>${n}</span></h4>${itens.length ? itens.join('') : `<p class="vazio-k">${vazio}</p>`}</div>`;
  // opções de <select> de projeto a partir de setoresLista (carrega em segundo plano); filtro opcional
  const opcoesSetor = filtro => (setoresLista || []).filter(filtro || (() => true)).map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
  const feitosLista = () => (relatoriosCache || []).filter(r => Date.now() - r.fim < 864e5).sort((a, b) => b.fim - a.fim).slice(0, 12);
  function colFeitosHtml() {
    const feitos = feitosLista();
    return col('Feito em 24h', feitos.length, feitos.map(r => cartao(curto(r.pedido, 70), `${r.agente} · ${nomeSala(r.setor)} · ${quando(r.fim)}`, corSetor(r.setor), r.sessao ? `data-agente="${esc(r.sessao)}"` : '')), 'Nenhuma entrega nas últimas 24h.', 'colFeitos');
  }
  function plano() {
    const ordens = ultimo?.ordens || [], ags = ultimo?.agentes || [];
    const fila = ordens.filter(o => o.naFila).sort((a, b) => a.criada - b.criada);
    const fazendo = ags.filter(a => a.estado === 'trabalhando');
    const esperando = [
      ...ags.filter(a => a.estado === 'esperando').map(a => {
        const rel = (relatoriosCache || []).filter(r => r.sessao === a.id).sort((x, y) => y.fim - x.fim)[0];
        const perg = rel?.simples?.pergunta || '';
        return `<div class="cartao-k resp"><i style="background:${corSetor(a.setor)}"></i><div><b data-agente="${esc(a.id)}">${esc(a.nome)} <span class="sub-k">${esc(nomeSala(a.setor))}</span></b>
          <small class="perg">${esc(perg ? curto(perg, 220) : 'quer falar com você')}</small>
          <form class="resp-rapida" data-sessao="${esc(a.id)}"><input data-rascunho="resp:${esc(a.id)}" maxlength="4000" placeholder="Responder ${esc(a.nome)}…" aria-label="Resposta para ${esc(a.nome)}">
            <button type="submit" value="conversa" title="Só responde, sem mexer em nada">Conversar</button><button type="submit" value="executar" class="principal-g" title="Ele continua o trabalho">Executar</button></form></div></div>`;
      }),
      ...(ultimo?.deploys || []).filter(d => d.status === 'aguardando').map(d => cartao('Publicação esperando você', `${nomeSala(d.setor)} · ${curto(d.resumo, 70)}`, 'var(--aviso)', d.sessao ? `data-agente="${esc(d.sessao)}"` : '')),
      ...(ultimo?.previas || []).filter(p => p.status === 'ativa').map(p => cartao('Prévia para você ver', `${nomeSala(p.setor)} · ${curto(p.descricao, 70)}`, 'var(--info)', p.sessao ? `data-agente="${esc(p.sessao)}"` : '')),
      ...(ultimo?.projetos || []).filter(p => p.status === 'aguardando').map(p => cartao('Plano do gerente para aprovar', p.titulo, 'var(--aviso)', 'data-extra="projetos"')),
      ...(ultimo?.aprendizado?.propostas || []).filter(p => p.status === 'aguardando').map(p => cartao(`${p.nome} quer melhorar o manual`, curto(p.resumo, 70), 'var(--destaque)', 'data-extra="aprendizado"')),
    ];
    const projetos = (ultimo?.projetos || []).filter(p => ['planejando', 'aguardando', 'executando'].includes(p.status));
    const rotP = { planejando: 'gerente planejando', aguardando: 'esperando sua aprovação', executando: 'em execução' };
    const eventos = proximosEventos();
    let diaAtual = '';
    const linhaTempo = eventos.map(e => {
      const d = e.t.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
      const cab = d !== diaAtual ? `<li class="dia-l">${esc(d)}</li>` : '';
      diaAtual = d;
      return `${cab}<li class="ev ${e.tipo}"><time>${esc(e.t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</time><span><b>${esc(curto(e.titulo, 80))}</b><small>${esc(e.quem)}</small></span></li>`;
    }).join('');
    const ids = (ultimo?.ideias || []).filter(i => i.status !== 'mandada').sort((a, b) => PRIOS.indexOf(a.prioridade) - PRIOS.indexOf(b.prioridade) || b.criada - a.criada);
    const rotPrio = { alta: 'alta', media: 'média', baixa: 'baixa' };
    const cartaoIdeia = i => `<div class="ideia ${esc(i.prioridade)}"><div class="ideia-topo"><b>${esc(i.titulo)}</b>
        <button class="prio ${esc(i.prioridade)}" data-ideia="${esc(i.id)}:mover:${PRIOS[(PRIOS.indexOf(i.prioridade) + 1) % 3]}" title="Trocar prioridade">${rotPrio[i.prioridade]}</button></div>
      <small><i style="background:${corSetor(i.setor)}"></i>${esc(nomeSala(i.setor))} · ${esc(quando(i.criada))}</small>
      <div class="ideia-acoes">${i.status === 'ideia' ? `<button data-ideia="${esc(i.id)}:mover:planejada">Planejar</button>` : `<button data-ideia="${esc(i.id)}:mover:ideia">Voltar</button>`}
        <button data-ideia="${esc(i.id)}:apagar" class="sutil">Apagar</button><button data-ideia="${esc(i.id)}:mandar" class="principal-g">Mandar</button></div></div>`;
    const colI = (titulo, lista, vazio) => `<div class="coluna-k"><h4>${titulo}<span>${lista.length}</span></h4>${lista.length ? lista.map(cartaoIdeia).join('') : `<p class="vazio-k">${vazio}</p>`}</div>`;
    const blocoIdeias = `<section class="bloco"><h3>Ideias</h3><p class="sub">Anote no campo lá em cima com “Guardar ideia”. Quando quiser, aperte Mandar e ela vira tarefa.</p>
      <div class="kanban">${colI('Ideias', ids.filter(i => i.status === 'ideia'), 'Nenhuma ideia anotada.')}${colI('Planejadas', ids.filter(i => i.status === 'planejada'), 'Nada planejado ainda.')}</div></section>`;
    const hojeMs = Date.now();
    const blocoMetas = `<section class="bloco"><div class="tit-linha"><h3>Metas</h3><span class="sub">Objetivos com prazo. Cada passo pode virar tarefa.</span></div>
      ${(ultimo?.metas || []).length ? (ultimo.metas).map(m => {
        const feitos = m.passos.filter(p => p.status === 'feito').length, tot = m.passos.length, pct = tot ? Math.round(feitos / tot * 100) : (m.status === 'concluida' ? 100 : 0);
        const dias = m.prazo ? Math.round((Date.parse(m.prazo + 'T12:00:00') - hojeMs) / 864e5) : null;
        const prazoTxt = dias == null ? 'sem prazo' : dias < 0 ? `atrasada ${-dias} dia(s)` : dias === 0 ? 'vence hoje' : `faltam ${dias} dia(s)`;
        const tom = m.status === 'concluida' ? 'bom' : dias != null && dias < 0 ? 'ruim' : dias != null && dias <= 7 && pct < 70 ? 'aviso' : '';
        return `<details class="meta ${m.status}" data-det="meta:${esc(m.id)}"><summary><i class="faixa" style="background:${corSetor(m.setor)}"></i>
          <div class="meta-txt"><b>${esc(m.titulo)}</b><small>${esc(nomeSala(m.setor))} · ${m.prazo ? esc(m.prazo.split('-').reverse().join('/')) + ' · ' : ''}<span class="${tom}">${esc(m.status === 'concluida' ? 'concluída' : prazoTxt)}</span></small>
            <div class="progresso"><span style="width:${pct}%"></span></div></div><span class="pct">${pct}%</span></summary>
          <ul class="passos-m">${m.passos.map(ps => `<li class="${ps.status}"><button class="check" data-meta="${esc(m.id)}:marcar:${esc(ps.id)}" aria-label="${ps.status === 'feito' ? 'Desmarcar' : 'Marcar como feito'}">${ps.status === 'feito' ? '✓' : ''}</button>
            <span>${esc(ps.texto)}${ps.status === 'fazendo' ? ' <em>· a equipe está fazendo</em>' : ''}</span>
            ${ps.status === 'aberto' ? `<button class="mini" data-meta="${esc(m.id)}:mandar:${esc(ps.id)}">Mandar</button>` : ''}<button class="mini sutil" data-meta="${esc(m.id)}:tirar:${esc(ps.id)}">×</button></li>`).join('')}</ul>
          <form class="novo-passo" data-meta="${esc(m.id)}"><input data-rascunho="passo:${esc(m.id)}" maxlength="300" placeholder="Novo passo…" aria-label="Novo passo"><button type="submit">Adicionar</button></form>
          <div class="meta-acoes"><button data-meta="${esc(m.id)}:concluir">${m.status === 'concluida' ? 'Reabrir' : 'Marcar meta como concluída'}</button><button class="sutil" data-meta="${esc(m.id)}:apagar">Apagar</button></div></details>`;
      }).join('') : '<p class="vazio-g">Nenhuma meta ainda.</p>'}
      <details class="nova-meta-d" data-det="nova-meta"><summary>+ Nova meta</summary>
        <form class="nova-meta"><div class="linha-f"><select name="setor" aria-label="Projeto" id="selSetorMeta">${opcoesSetor()}</select>
          <input name="prazo" type="date" data-rascunho="meta:prazo" aria-label="Prazo"></div>
          <input name="titulo" data-rascunho="meta:titulo" maxlength="160" placeholder="Ex.: lançar o app na loja" aria-label="Meta">
          <textarea name="passos" data-rascunho="meta:passos" rows="3" placeholder="Passos, um por linha (opcional)" aria-label="Passos"></textarea>
          <button type="submit" class="principal-g">Criar meta</button></form></details></section>`;
    return `${blocoMetas}${blocoIdeias}<section class="bloco largo"><h3>Quadro do trabalho</h3><p class="sub">O que está acontecendo agora. Clique num cartão para abrir a conversa.</p>
      <div class="kanban">
        ${col('Na fila', fila.length, fila.map(o => cartao(o.pedido, `${nomeSala(o.setor)} · ${o.triando ? 'escolhendo especialista' : 'esperando vaga'}`, corSetor(o.setor))), 'Nada esperando.')}
        ${col('Fazendo', fazendo.length, fazendo.map(a => cartao(a.nome, `${nomeSala(a.setor)} · ${curto(a.acao || a.pedido || 'trabalhando', 60)}`, corSetor(a.setor), `data-agente="${esc(a.id)}"`)), 'Ninguém trabalhando agora.')}
        ${col('Esperando você', esperando.length, esperando, 'Nada esperando você.')}
        ${colFeitosHtml()}
      </div></section>
      <section class="bloco"><h3>Próximos 7 dias</h3><p class="sub">Rotinas automáticas e tarefas que você agendou.</p>
        ${eventos.length ? `<ol class="linha-tempo">${linhaTempo}</ol>` : '<p class="vazio-g">Nada programado.</p>'}
        <button class="link-g" data-extra="agenda">Agendar uma tarefa</button></section>
      <section class="bloco"><h3>Projetos com o gerente</h3>
        ${projetos.length ? `<ul class="lista-g">${projetos.map(p => `<li data-extra="projetos"><b>${esc(p.titulo)}</b><small>${esc(rotP[p.status])} · ${esc(nomeSala(p.setor))}${(p.tarefas || []).length ? ` · ${(p.tarefas || []).filter(t => t.status === 'feito').length}/${p.tarefas.length} tarefas` : ''}</small></li>`).join('')}</ul>` : '<p class="vazio-g">Nenhum projeto em andamento.</p>'}
        <button class="link-g" data-extra="projetos">Abrir projetos</button></section>`;
  }

  function blocoReuniao() {
    const rs = ultimo?.reunioes || [], andando = rs.find(r => r.status === 'andando');
    const nomeEsp = id => avatares.get('fixo:' + id)?.nome || (ultimo?.especialidades || []).find(e => e.id === id)?.nome || id;
    const papelEsp = id => (ultimo?.especialidades || []).find(e => e.id === id)?.nome || id;
    const viva = andando ? `<div class="reuniao-viva"><div class="rv-topo"><span class="ao-vivo">${esc(andando.fase || 'em andamento')}</span><b>${esc(curto(andando.tema, 140))}</b>
        <small>${esc(andando.participantes.map(nomeEsp).join(', '))} · ${esc(nomeSala(andando.setor))} · começou ${esc(quando(andando.inicio))}</small></div>
        ${andando.falas.map(f => `<div class="fala"><span class="fala-quem">${esc(nomeEsp(f.quem))} <small>rodada ${f.rodada}</small></span><p>${esc(f.texto)}</p></div>`).join('') || '<p class="vazio-g">Eles estão olhando o projeto e pensando…</p>'}</div>` : '';
    const sel = rascunhos['reu:sel'] || [];
    const form = andando ? '' : `<form class="nova-reuniao"><textarea name="tema" data-rascunho="reu:tema" rows="2" maxlength="3000" placeholder="Qual é o problema? Ex.: o app está lento para abrir a agenda. Qual o melhor caminho?" aria-label="Assunto da reunião"></textarea>
        <div class="linha-f"><select name="setor" aria-label="Projeto" id="selSetorReuniao">${opcoesSetor()}</select><span class="dica-r">Escolha 2 ou 3:</span></div>
        <div class="escolha-esp">${(ultimo?.especialidades || []).filter(e => e.id !== 'po').map(e => `<label class="${sel.includes(e.id) ? 'marcado' : ''}"><input type="checkbox" name="p" value="${esc(e.id)}" ${sel.includes(e.id) ? 'checked' : ''}>${esc(nomeEsp(e.id))} <small>${esc(papelEsp(e.id))}</small></label>`).join('')}</div>
        <button type="submit" class="principal-g">Chamar reunião</button></form>`;
    const passadas = rs.filter(r => r.status !== 'andando').slice(0, 5);
    return `<section class="bloco"><div class="tit-linha"><h3>Reunião</h3><span class="sub">Chame 2 ou 3 especialistas para discutir um problema. Eles conversam entre si e te entregam uma decisão. Só leem o projeto, não mexem em nada.</span></div>
      ${viva}${form}
      ${passadas.length ? `<ul class="lista-g">${passadas.map(r => `<li data-agente="reuniao-${esc(r.id)}"><i class="ponto-cor ${r.status === 'concluida' ? 'ok' : 'parado'}"></i><b>${esc(curto(r.tema, 90))}</b>
        <small>${esc(r.participantes.map(nomeEsp).join(', '))} · ${esc(quando(r.fim || r.inicio))}${r.status === 'concluida' ? ' · ' + esc(curto(r.decisao?.texto || '', 90)) : ' · ' + esc(r.erro || 'não terminou')}</small></li>`).join('')}</ul>` : ''}</section>`;
  }
  function equipe() {
    if (!dados) return carregando();
    return `${blocoReuniao()}<section class="bloco"><h3>Quem faz o quê</h3><p class="sub">Responsabilidade, permissões e o que cada especialista entregou nos últimos 30 dias.</p>
      <input id="filtroEquipe" type="search" placeholder="Procurar especialista ou responsabilidade" value="${esc(filtroEquipe)}" autocomplete="off"></section>
      <div class="equipe-g largo" id="equipeLista">${listaEquipe()}</div>`;
  }
  function listaEquipe() {
    const f = filtroEquipe.trim().toLowerCase();
    const itens = dados.equipe.filter(e => !f || [e.nome, e.descricao, ...e.responsabilidades].join(' ').toLowerCase().includes(f))
      .sort((a, b) => b.mes - a.mes || a.nome.localeCompare(b.nome));
    if (!itens.length) return '<p class="vazio-g">Ninguém com esse termo.</p>';
    return itens.map(e => {
      const av = avatares.get('fixo:' + e.id), nome = av?.nome || e.nome;
      const qa = e.revisados ? `${Math.round(e.aprovados / e.revisados * 100)}% aprovado pelo QA` : '';
      return `<article class="membro">
        <header><span class="avatar" style="background:${esc(e.cor || '#888780')}">${esc(nome.slice(0, 1).toUpperCase())}</span><div><b>${esc(nome)}</b><small>${esc(e.nome)}</small></div>
          ${e.modelo ? `<span class="chip modelo">${esc(e.modelo)}</span>` : ''}</header>
        ${e.descricao ? `<p>${esc(e.descricao)}</p>` : ''}
        ${e.responsabilidades.length ? `<ul class="resp">${e.responsabilidades.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        <div class="chips"><span class="chip ${e.edita ? '' : 'leve'}">${e.edita ? 'edita arquivos' : 'só lê arquivos'}</span><span class="chip ${e.comandos ? '' : 'leve'}">${e.comandos ? 'roda comandos' : 'sem comandos'}</span>
          ${e.projetos.map(p => `<span class="chip leve">${esc(p)}</span>`).join('')}</div>
        <footer><span><b>${e.mes}</b> entregas em 30 dias</span>${qa ? `<span>${esc(qa)}</span>` : ''}${e.refazer ? `<span class="ruim">${e.refazer} para refazer</span>` : ''}<span>última ${esc(quando(e.ultima))}</span>
          ${av ? `<button data-conversar="${esc(e.id)}">Conversar</button>` : ''}</footer>
      </article>`;
    }).join('');
  }
  function desenharEquipeLista() { const l = el.querySelector('#equipeLista'); if (l && dados) l.innerHTML = listaEquipe(); }

  function infra() {
    if (!dados) return carregando();
    const m = dados.metricas.at(-1);
    const medidor = (rot, v, k, lim, nota) => `<div class="metrica"><div class="m-topo"><span>${rot}</span><b class="${v >= lim ? 'ruim' : ''}">${v == null ? '–' : v + '%'}</b></div>${sparkline(k, lim)}<small>${nota}</small></div>`;
    const servs = ultimo?.servidores || [];
    const rotSaude = { ok: 'tudo certo', atencao: 'atenção', parado: 'parado' };
    const wa = dados.whatsapp.numeros;
    const rotinasLista = [
      ['Vigia da infraestrutura', 'vigia', 'a cada 5 min'], ['Vigia do WhatsApp', 'whatsapp', 'de hora em hora'], ['Datacenter', 'datacenter', 'a cada 30 s'], ['Métricas do servidor', 'metricas', 'a cada 15 min'],
    ].map(([nome, k, freq]) => { const r = dados.rotinas[k]; return { nome, freq, ok: r && !r.erro, ultima: r?.ultima, erro: r?.erro, ms: r?.ms }; });
    const re = ultimo?.rotinas?.estado || {};
    rotinasLista.push({ nome: 'Ronda da produção (DevOps)', freq: 'todo dia', ok: !re.devops?.erro, ultima: re.devops?.ultima, erro: re.devops?.erro });
    const bk = dados.backup;
    rotinasLista.push({ nome: 'Backup do escritório', freq: 'todo dia 03:30', ok: bk.resultado === 'success', ultima: bk.quando, erro: bk.resultado && bk.resultado !== 'success' ? 'último backup falhou' : '' });
    return `<section class="bloco"><h3>Servidor (${esc(ultimo?.nomeServidor || 'servidor')})</h3><p class="sub">Últimos 7 dias. A linha tracejada é o ponto de alerta.</p>
        <div class="metricas">${medidor('Memória', m?.mem, 'mem', 90, 'quanto da RAM está em uso')}${medidor('Disco', m?.disco, 'disco', 85, 'espaço ocupado')}${medidor('Swap', m?.swap, 'swap', 90, 'memória de reserva no disco')}</div></section>
      <section class="bloco"><h3>Sistemas</h3><p class="sub">Racks do datacenter${ultimo?.servidoresEm ? ', conferidos ' + quando(ultimo.servidoresEm) : ''}.</p>
        <ul class="lista-g sistemas">${servs.map(g => `<li><i class="ponto-cor ${esc(g.saude)}"></i><b>${esc(g.nome)}</b><small>${esc(g.tipo === 'interno' ? 'uso interno' : g.tipo === 'infra' ? 'infraestrutura' : 'produção')} · ${g.containers.length} containers · ${esc(rotSaude[g.saude] || g.saude)}</small>${g.legenda ? `<small class="descricao-g">${esc(g.legenda)}</small>` : ''}</li>`).join('')}</ul></section>
      <section class="bloco"><h3>WhatsApp das lojas</h3><p class="sub">Conferido ${esc(quando(dados.whatsapp.conferidoEm))}. Número travado vira incidente depois de 2h sem mensagem em horário comercial.</p>
        <label class="wa-auto"><input type="checkbox" data-wa-auto ${ultimo?.whatsappAuto?.ativo ? 'checked' : ''}><span><b>Reiniciar sozinho quando travar</b><small>O agente do WhatsApp reinicia só a conexão do número travado (no máximo 1 vez a cada 3 horas por número) e confere depois de 15 minutos. Número desconectado (precisa de QR) só gera aviso.</small></span></label>
        ${(ultimo?.whatsappAuto?.reinicios || []).length ? `<ul class="lista-g">${ultimo.whatsappAuto.reinicios.slice(0, 5).map(h => `<li><i class="ponto-cor ${h.ok ? 'ok' : 'parado'}"></i><b>${esc(h.ok ? 'Reiniciou' : 'Não conseguiu reiniciar')} · ${esc(h.loja)}</b><small>${esc(h.sistema)} · ${esc(quando(h.t))}${h.detalhe ? ' · ' + esc(h.detalhe) : ''}</small></li>`).join('')}</ul>` : ''}
        ${wa.length ? `<ul class="lista-g">${wa.map(n => `<li><i class="ponto-cor ${n.estado !== 'open' ? 'parado' : n.minutosParado >= 120 ? 'atencao' : 'ok'}"></i><b>${esc(n.loja)}</b><small>${esc(n.sistema)} · ${n.estado === 'open' ? 'conectado' : 'desconectado'} · última mensagem ${esc(quando(n.ultima))} · ${n.mensagens7d} de clientes na semana</small></li>`).join('')}</ul>` : '<p class="vazio-g">Ainda não conferido.</p>'}</section>
      <section class="bloco"><h3>Avisos técnicos</h3><p class="sub">Os últimos problemas que o escritório percebeu, antes de virar um serviço parado.</p>
        ${dados.avisosTecnicos?.length ? `<ul class="lista-g">${dados.avisosTecnicos.map(a => `<li><i class="ponto-cor atencao"></i><b>${esc(curto(a.texto, 160))}</b><small>${esc(quando(a.t))}</small></li>`).join('')}</ul>` : '<p class="vazio-g">Nenhum aviso recente.</p>'}</section>
      <section class="bloco"><h3>Rotinas do escritório</h3><p class="sub">Se alguma parar de rodar, aparece aqui.</p>
        <ul class="lista-g">${rotinasLista.map(r => `<li><i class="ponto-cor ${r.erro ? 'parado' : r.ultima ? 'ok' : ''}"></i><b>${esc(r.nome)}</b><small>${esc(r.freq)} · ${r.ultima ? 'última ' + esc(quando(r.ultima)) : 'ainda não rodou'}${r.erro ? ' · erro: ' + esc(curto(r.erro, 90)) : ''}</small></li>`).join('')}</ul>
        <p class="rodape-g">Escritório no ar ${esc(quando(dados.escritorio.desde).replace('há ', 'há '))} · ${dados.escritorio.memoriaMB} MB de memória · ${dados.escritorio.relatorios} relatórios guardados${bk.ultimo ? ' · backup: ' + esc(bk.ultimo) : ''}</p></section>`;
  }

  function ajudaAba() {
    const perguntas = ultimo?.ajuda || [];
    return `<section class="bloco"><h3>Perguntas frequentes</h3><p class="sub">Respostas simples para as dúvidas que mais aparecem. Clique numa pergunta para ver a resposta.</p>
      ${perguntas.length ? perguntas.map((p, i) => `<details class="faq" data-det="ajuda:${i}"><summary>${esc(p.pergunta)}</summary><p>${esc(p.resposta)}</p></details>`).join('') : '<p class="vazio-g">Ainda não há perguntas cadastradas.</p>'}</section>`;
  }

  function projetosAba() {
    const setores = (ultimo?.setores || []).filter(x => x.id !== 'escritorio');
    const servs = ultimo?.servidores || [], ags = ultimo?.agentes || [], incs = (ultimo?.incidentes || []).filter(i => i.status === 'aberto');
    const ordemSaude = { parado: 0, atencao: 1, ok: 2 };
    const fichas = setores.map(st => {
      const racks = servs.filter(g => g.setor === st.id);
      const saude = racks.length ? racks.map(g => g.saude).sort((a, b) => ordemSaude[a] - ordemSaude[b])[0] : null;
      const meus = ags.filter(a => a.setor === st.id), trab = meus.filter(a => a.estado === 'trabalhando'), esp = meus.filter(a => a.estado === 'esperando');
      const num = dados?.porSetor.find(x => x.setor === st.id), ult = dados?.ultimasPorSetor?.[st.id] || [];
      const pend = (ultimo?.deploys || []).filter(d => d.setor === st.id && d.status === 'aguardando').length + (ultimo?.previas || []).filter(p => p.setor === st.id && p.status === 'ativa').length;
      const inc = incs.filter(i => i.setor === st.id).length, idsN = (ultimo?.ideias || []).filter(i => i.setor === st.id && i.status !== 'mandada').length;
      const po = (ultimo?.pos || []).find(x => x.setor === st.id);
      const fav = favoritos.has(st.id);
      const peso = trab.length * 100 + esp.length * 50 + inc * 200 + (num?.semana || 0);
      return { peso, fav, html: `<article class="ficha-proj${fav ? ' favorita' : ''}">
        <header><i class="faixa" style="background:${esc(st.cor || '#888780')}"></i><div><b>${esc(st.nome)}</b>
          <small>${num ? `${num.tarefas} entregas em 30 dias · ${num.semana} na semana` : 'sem entregas recentes'}</small></div>
          <button class="favorito${fav ? ' ativo' : ''}" data-favorito="${esc(st.id)}" aria-pressed="${fav}" title="${fav ? 'Desafixar projeto' : 'Fixar projeto no topo'}" aria-label="${fav ? 'Desafixar' : 'Fixar'} ${esc(st.nome)}">★</button>
          ${saude ? `<span class="saude ${esc(saude)}">${{ ok: 'no ar', atencao: 'atenção', parado: 'fora do ar' }[saude]}</span>` : ''}</header>
        <div class="chips">${trab.length ? `<span class="chip">${trab.length} trabalhando</span>` : ''}${esp.length ? `<span class="chip aviso">${esp.length} esperando você</span>` : ''}
          ${inc ? `<span class="chip ruim">${inc} incidente${inc > 1 ? 's' : ''}</span>` : ''}${pend ? `<span class="chip aviso">${pend} para você ver</span>` : ''}
          ${idsN ? `<span class="chip leve">${idsN} ideia${idsN > 1 ? 's' : ''}</span>` : ''}${racks.length ? `<span class="chip leve">${racks.reduce((a, g) => a + g.containers.length, 0)} containers</span>` : ''}</div>
        ${ult.length ? `<ul class="ultimas">${ult.map(u => `<li ${u.sessao ? `data-agente="${esc(u.sessao)}"` : ''}><span>${esc(u.pedido)}</span><small>${esc(u.agente)} · ${esc(quando(u.t))}</small></li>`).join('')}</ul>` : ''}
        <footer><button data-pedir="${esc(st.id)}">Pedir algo</button>${po && avatares.get('po:' + st.id) ? `<button data-agente="po:${esc(st.id)}">Falar com ${esc(po.nome)} (PO)</button>` : ''}</footer>
      </article>` };
    }).sort((a, b) => (b.fav - a.fav) || (b.peso - a.peso));
    return `<section class="bloco solto largo"><h3>Seus projetos</h3><p class="sub">Fixados primeiro, depois os mais movimentados.</p></section>${fichas.map(f => f.html).join('')}`;
  }
  // fileira simples de barrinhas (html/css, sem svg): quanto a equipe trabalhou em cada um dos últimos 14 dias
  function barrinhasDias() {
    const dias = dados?.dias || [];
    if (!dias.length) return '';
    const maior = Math.max(1, ...dias.map(d => dados.porDia[d]?.total || 0));
    const cols = dias.map((d, i) => {
      const n = dados.porDia[d]?.total || 0, h = Math.max(4, Math.round(n / maior * 100));
      return `<li title="${esc(diaCurto(d))} · ${n} entrega${n === 1 ? '' : 's'}"><span style="height:${h}%"></span><small>${i === dias.length - 1 ? 'hoje' : diaCurto(d)}</small></li>`;
    }).join('');
    return `<ul class="barrinhas-dias" role="img" aria-label="Tarefas entregues por dia nos últimos 14 dias">${cols}</ul>`;
  }
  function atividadeAba() {
    if (!dados) return carregando();
    const filtros = [['tudo', 'Tudo'], ['entrega', 'Entregas'], ['incidente', 'Incidentes'], ['publicacao', 'Publicações'], ['outros', 'Projetos e ideias']];
    return `<section class="bloco"><h3>Movimento dos últimos 14 dias</h3><p class="sub">Quantas tarefas a equipe entregou em cada dia. Passe o mouse numa barra para ver o número.</p>${barrinhasDias()}</section>
      <section class="bloco"><h3>O que aconteceu</h3><p class="sub">Últimas 48 horas no escritório.</p>
      <div class="filtros" role="radiogroup">${filtros.map(([k, r]) => `<label class="${filtroAtiv === k ? 'ativo' : ''}"><input type="radio" name="filtroAtiv" value="${k}" ${filtroAtiv === k ? 'checked' : ''}>${r}</label>`).join('')}</div>
      <input id="filtroTextoAtiv" type="search" placeholder="Procurar por projeto ou palavra do pedido" value="${esc(filtroTextoAtiv)}" autocomplete="off"></section>
      <div id="atividadeLista">${listaAtividade()}</div>`;
  }
  function listaAtividade() {
    const grupos = { tudo: null, entrega: ['entrega'], incidente: ['incidente', 'resolvido'], publicacao: ['publicacao', 'publicado', 'previa'], outros: ['projeto', 'ideia'] };
    const f = filtroTextoAtiv.trim().toLowerCase();
    const lista = dados.atividade.filter(a => (!grupos[filtroAtiv] || grupos[filtroAtiv].includes(a.tipo))
      && (!f || [a.texto, nomeSala(a.setor)].join(' ').toLowerCase().includes(f)));
    const rotDia = t => { const d = new Date(t), h = new Date(); const ontem = new Date(h); ontem.setDate(h.getDate() - 1);
      return d.toDateString() === h.toDateString() ? 'Hoje' : d.toDateString() === ontem.toDateString() ? 'Ontem' : d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }); };
    let dia = '';
    const itens = lista.map(a => {
      const d = rotDia(a.t), cab = d !== dia ? `<li class="dia-l">${esc(d)}</li>` : '';
      dia = d;
      return `${cab}<li class="at ${esc(a.tipo)}" ${a.sessao ? `data-agente="${esc(a.sessao)}"` : ''}><time>${esc(new Date(a.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</time>
        <span><b>${esc(a.texto)}</b><small><i style="background:${corSetor(a.setor)}"></i>${esc(nomeSala(a.setor))}${a.ok === true ? ' · aprovado pelo QA' : a.ok === false ? ' · QA pediu ajuste' : ''}</small></span></li>`;
    }).join('');
    return lista.length ? `<ol class="linha-tempo atividade">${itens}</ol>` : '<p class="vazio-g">Nada por aqui nesse período.</p>';
  }
  function desenharAtividadeLista() { const l = el.querySelector('#atividadeLista'); if (l && dados) l.innerHTML = listaAtividade(); }

  function publicacoesAba() {
    if (!pubs) { buscarPub(); return carregando(); }
    const todos = pubs.itens;
    const setoresComItens = [...new Set(todos.map(i => i.setor).filter(Boolean))];
    const filtros = [['todos', 'Todos'], ...setoresComItens.map(id => [id, nomeSala(id)]), ['apps', 'Apps (celular)']];
    const lista = todos.filter(i => filtroPub === 'todos' || (filtroPub === 'apps' ? i.fonte === 'app' : i.setor === filtroPub));
    const noAr = lista.filter(i => i.atual || (i.fonte === 'app' && !lista.some(o => o.fonte === 'app' && o.app === i.app && o.t > i.t)));
    const rotSt = { ok: 'no ar', falhou: 'falhou', publicando: 'publicando', cancelado: 'cancelado' };
    const quandoCompleto = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const pend = pubs.pendentes || [];
    let dia = '';
    const linha = lista.slice(0, 150).map(i => {
      const d = new Date(i.t).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }), cab = d !== dia ? `<li class="dia-l">${esc(d)}</li>` : '';
      dia = d;
      return `${cab}<li class="pub ${esc(i.status)} ${i.atual ? 'atual' : ''}">
        <time>${esc(new Date(i.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</time>
        <div class="pub-corpo"><div class="pub-topo"><b>${esc(i.app)}</b>${i.ambiente ? `<span class="chip leve">${esc(i.ambiente)}</span>` : ''}${i.versao ? `<code>${esc(i.versao)}</code>` : ''}
          ${i.status !== 'ok' ? `<span class="chip ${i.status === 'falhou' ? 'ruim' : 'aviso'}">${esc(rotSt[i.status] || i.status)}</span>` : ''}${i.tipo === 'volta' ? '<span class="chip aviso">volta de versão</span>' : ''}${i.atual ? '<span class="chip bom">no ar agora</span>' : ''}</div>
          ${i.mensagem ? `<p>${esc(i.mensagem)}</p>` : ''}<small><i style="background:${corSetor(i.setor)}"></i>${esc(i.setor ? nomeSala(i.setor) : 'sem projeto')} · ${esc(i.quem)}</small>
          ${i.podeVoltar ? `<button class="voltar" data-voltar="${esc(i.id)}">Voltar para esta versão</button>` : ''}</div></li>`;
    }).join('');
    return `${pend.length ? `<section class="bloco alerta-pub"><h3>Esperando você apertar Publicar</h3>
        ${pend.map(d => `<div class="pend"><div><b>${esc(nomeSala(d.setor))}</b><p>${esc(curto(d.resumo, 220))}</p><small>pedido por ${esc(d.agente)} · ${esc(quando(d.criado))}</small></div>
          <div class="pend-acoes"><button data-pub-cancelar="${esc(d.id)}">Cancelar</button><button class="principal-g" data-pub-publicar="${esc(d.id)}">Publicar</button></div></div>`).join('')}
        <p class="rodape-g">Ao publicar, o DevOps confere estado, migrations e backup antes, e verifica no ar depois.</p></section>` : ''}
      <section class="bloco"><h3>Versão atual</h3><p class="sub">O que está no ar em cada sistema e o último pacote de cada app.</p>
        ${noAr.length ? `<div class="no-ar">${noAr.map(i => `<div class="no-ar-item"><i style="background:${corSetor(i.setor)}"></i><div><b>${esc(i.app)}</b><small>${esc([i.ambiente, i.versao].filter(Boolean).join(' · '))}</small><small>${esc(quandoCompleto(i.t))}</small></div></div>`).join('')}</div>` : '<p class="vazio-g">Nada registrado ainda.</p>'}</section>
      <section class="bloco"><h3>Histórico de publicações</h3><p class="sub">Coolify, apps das lojas, publicar.sh e trocas de versão que o escritório percebe. “Voltar” só cria um pedido: nada acontece sem você apertar Publicar.</p>
        <div class="filtros">${filtros.map(([k, r]) => `<label class="${filtroPub === k ? 'ativo' : ''}"><input type="radio" name="filtroPub" value="${esc(k)}" ${filtroPub === k ? 'checked' : ''}>${esc(r)}</label>`).join('')}</div>
        ${lista.length ? `<ol class="linha-tempo pubs">${linha}</ol>` : '<p class="vazio-g">Nenhuma publicação nesse filtro.</p>'}</section>`;
  }

  const DIAS_S = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const rotinaTxt = r => !r?.ativo ? 'sob demanda' : r.freq === 'mensal' ? `todo dia ${r.dia} do mês às ${r.hora}` : `toda ${DIAS_S[r.dia]} às ${r.hora}`;
  function empresaAba() {
    const ds = ultimo?.departamentos || [], props = (ultimo?.propostasRH || []).filter(p => p.status === 'aguardando');
    const nomeEsp = id => avatares.get('fixo:' + id)?.nome ? `${avatares.get('fixo:' + id).nome} (${(ultimo?.especialidades || []).find(e => e.id === id)?.nome || id})` : ((ultimo?.especialidades || []).find(e => e.id === id)?.nome || id);
    const blocoRH = props.length ? `<section class="bloco alerta-pub"><h3>RH quer contratar</h3><p class="sub">Nada muda sem você aprovar. Ao aprovar, o especialista entra na equipe com o manual abaixo.</p>
      ${props.map(p => `<div class="contratacao"><div class="ct-topo"><span class="avatar" style="background:${esc(p.especialista.cor)}">${esc(p.especialista.nome.slice(0, 1))}</span><div><b>${esc(p.especialista.nome)}</b><small>${esc(p.especialista.descricao)} · ${esc(p.especialista.modelo)}</small></div></div>
        <p>${esc(p.motivo)}</p><details><summary>Ver o manual proposto</summary><pre class="manual">${esc(p.especialista.manual)}</pre></details>
        <div class="pend-acoes"><button data-rh="${esc(p.id)}:recusar">Recusar</button><button class="principal-g" data-rh="${esc(p.id)}:aprovar">Contratar</button></div></div>`).join('')}</section>` : '';
    const ideias = (ultimo?.propostasMelhoria || []).filter(p => p.status === 'aguardando');
    const rotTipo = { setor: 'setor novo', visual: 'visual', funcionalidade: 'funcionalidade', tecnologia: 'tecnologia', layout: 'layout' };
    const blocoCresc = ideias.length ? `<section class="bloco largo alerta-pub"><div class="tit-linha"><h3>Ideias de crescimento esperando você</h3><span class="sub">${ideias.length} para aprovar. Só vira tarefa o que você aprovar.</span></div>
      <div class="ideias-cresc">${ideias.map(p => `<article class="cresc"><div class="cresc-topo"><span class="chip tipo-${esc(p.tipo || 'funcionalidade')}">${esc(rotTipo[p.tipo] || 'ideia')}</span><span class="chip leve">${esc(p.tamanho || 'pequena')}</span><small>${esc(quando(p.criada))}</small></div>
        <b>${esc(p.titulo)}</b><p>${esc(p.porque)}</p>
        <details><summary>Como seria feito</summary><p class="como">${esc(p.oque)}</p>${p.risco ? `<p class="como"><b>Risco:</b> ${esc(p.risco)}</p>` : ''}</details>
        <form class="decidir-cresc" data-id="${esc(p.id)}"><input name="motivo" data-rascunho="cresc:${esc(p.id)}" maxlength="300" placeholder="Se recusar, diga por quê (opcional)" aria-label="Motivo da recusa">
          <button type="submit" value="recusar">Recusar</button><button type="submit" value="aprovar" class="principal-g">Aprovar</button></form></article>`).join('')}</div></section>` : '';
    return `${blocoCresc}${blocoRH}<section class="bloco solto largo"><h3>Departamentos</h3><p class="sub">Cada área tem a sua sala no andar da empresa, os seus especialistas e uma rotina. Os relatórios chegam nas Conversas.</p></section>
      <div class="deptos largo">${ds.map(d => {
        const e = d.estado || {};
        return `<article class="depto" style="--c:${esc(d.cor)}"><header><i></i><div><b>${esc(d.nome)}</b><small>${esc(rotinaTxt(d.rotina))}</small></div>
            <span class="dep-st ${e.rodando ? 'rodando' : e.erro ? 'erro' : ''}">${e.rodando ? 'trabalhando…' : e.erro ? 'deu erro' : e.ultima ? 'último ' + esc(quando(e.ultima)) : 'ainda não rodou'}</span></header>
          <ul class="resp">${(d.responsabilidades || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
          <div class="chips">${(d.membros || []).map(m => `<span class="chip leve">${esc(nomeEsp(m))}</span>`).join('')}</div>
          <footer><button data-dep-rodar="${esc(d.id)}" ${e.rodando ? 'disabled' : ''}>Pedir agora</button><button data-dep-ver="${esc(d.id)}">Relatórios</button>
            ${avatares.get('fixo:' + d.lider) ? `<button data-conversar="${esc(d.lider)}">Conversar</button>` : ''}<button data-dep-sala="${esc(d.id)}">Ver a sala</button></footer></article>`;
      }).join('')}</div>`;
  }
  const reais = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function financeiroAba() {
    if (!fin) { buscarFin(); return carregando(); }
    buscarFin();
    const ps = fin.projetos.filter(p => p.total > 0 || p.servicos.length || p.memoriaMB || p.usoClaude);
    const max = Math.max(1, ...ps.map(p => p.total));
    const semCadastro = !fin.custos.length;
    const cats = { claude: 'Assinatura do Claude', servidor: 'Servidor (VPS)', dominio: 'Domínio', loja: 'Loja de apps', api: 'API paga', servico: 'Serviço', outro: 'Outro' };
    return `<div class="kpis largo">${kpi(reais(fin.totalMensal), 'custo por mês')}${kpi(reais(fin.assinatura), 'assinatura do Claude')}${kpi(reais(fin.servidor), 'servidor')}</div>
      ${semCadastro ? `<section class="bloco alerta-pub"><h3>Comece cadastrando os custos</h3><p class="sub" style="margin:0">Cadastre a assinatura do Claude (categoria “Assinatura do Claude”) e a VPS (categoria “Servidor”) como custos gerais. O Financeiro divide entre os projetos pelo uso. Depois cadastre domínios, lojas de apps e APIs em cada projeto.</p></section>` : ''}
      <section class="bloco"><h3>Quanto cada projeto custa por mês</h3><p class="sub">Custos diretos + parte da assinatura do Claude (pelo uso nos últimos 30 dias) + parte do servidor (70% memória, 30% disco). As partes são estimativas.</p>
        ${ps.length ? `<ul class="fin-barras">${ps.map(p => `<li><span class="bh-nome">${esc(p.nome)}</span><span class="fin-trilho">
            <i style="width:${p.diretos / max * 100}%;background:${esc(p.cor)}" title="diretos ${reais(p.diretos)}"></i><i style="width:${p.claude / max * 100}%;background:var(--info)" title="Claude ${reais(p.claude)}"></i><i style="width:${p.servidor / max * 100}%;background:var(--aviso)" title="servidor ${reais(p.servidor)}"></i></span>
            <span class="bh-valor">${reais(p.total)}</span></li>`).join('')}</ul>
          <ul class="legenda-g"><li><i style="background:var(--g-outros)"></i>custos diretos</li><li><i style="background:var(--info)"></i>parte do Claude</li><li><i style="background:var(--aviso)"></i>parte do servidor</li></ul>` : '<p class="vazio-g">Sem dados ainda.</p>'}</section>
      <section class="bloco largo"><h3>Detalhe por projeto</h3>
        <div class="fin-tabela"><table><thead><tr><th>Projeto</th><th>Uso do Claude</th><th>Memória · disco</th><th>Equivalente na API</th><th>Serviços pagos</th></tr></thead><tbody>
          ${fin.projetos.map(p => `<tr><td><b>${esc(p.nome)}</b></td><td>${p.usoClaude}%</td><td>${p.memoriaMB} MB · ${(p.discoMB / 1024).toFixed(1)} GB</td><td>${fin.cambio ? reais(p.equivalenteApiUSD * fin.cambio) : 'US$ ' + p.equivalenteApiUSD.toFixed(2)}</td><td>${p.servicos.map(x => `<span class="chip leve">${esc(x)}</span>`).join(' ') || '–'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="rodape-g">“Equivalente na API” é só referência: o escritório usa a assinatura, sem cobrança extra. Os serviços pagos são detectados pelas dependências do código; confirme e cadastre o valor de cada um.</p></section>
      <section class="bloco"><h3>Custos cadastrados</h3>
        ${fin.custos.length ? `<ul class="lista-g">${fin.custos.map(c => `<li><b>${esc(c.nome)} · ${reais(c.valor)}${c.recorrencia === 'anual' ? '/ano' : c.recorrencia === 'unico' ? ' (único)' : '/mês'}</b><small>${esc(cats[c.categoria] || c.categoria)} · ${esc(c.setor === 'geral' ? 'geral (dividido entre os projetos)' : nomeSala(c.setor))} <button class="mini-x" data-custo-apagar="${esc(c.id)}">apagar</button></small></li>`).join('')}</ul>` : '<p class="vazio-g">Nenhum custo cadastrado.</p>'}
        <form class="novo-custo"><input name="nome" data-rascunho="custo:nome" maxlength="80" placeholder="Ex.: Claude Max, VPS, domínio do site" aria-label="Nome do custo" required>
          <input name="valor" data-rascunho="custo:valor" inputmode="decimal" placeholder="Valor em R$" aria-label="Valor em reais" required>
          <select name="recorrencia" aria-label="Recorrência"><option value="mensal">por mês</option><option value="anual">por ano</option><option value="unico">uma vez</option></select>
          <select name="categoria" aria-label="Categoria">${Object.entries(cats).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select name="setor" aria-label="Projeto" id="selSetorCusto"><option value="geral">Geral (dividir entre projetos)</option>${opcoesSetor(x => x.id !== 'escritorio' && x.id !== 'geral')}</select>
          <button type="submit" class="principal-g">Cadastrar</button></form></section>
      <section class="bloco"><h3>Relatório do Financeiro</h3><p class="sub">Toda sexta às 16h o Financeiro analisa os números, aponta gastos fora do normal e propõe economias.</p>
        <div class="pend-acoes"><button data-dep-ver="financeiro">Ver relatórios</button><button class="principal-g" data-dep-rodar="financeiro">Pedir análise agora</button></div></section>`;
  }

  // html da aba atual (usado no redesenho normal e para recalcular o cache sem repintar, nas atualizações parciais abaixo)
  function htmlDaAba() {
    return aba === 'plano' ? plano() : aba === 'projetos' ? projetosAba() : aba === 'empresa' ? empresaAba() : aba === 'financeiro' ? financeiroAba() : aba === 'publicacoes' ? publicacoesAba() : aba === 'atividade' ? atividadeAba() : aba === 'equipe' ? equipe() : aba === 'infra' ? infra() : aba === 'ajuda' ? ajudaAba() : geral();
  }
  // relatórios chegam um instante depois do resto: só troca a coluna "Feito em 24h", sem repintar a aba inteira
  function atualizarFeitosEmPlano() {
    if (!aberta || aba !== 'plano') return;
    const alvo = conteudo.querySelector('#colFeitos');
    if (!alvo) return desenhar(); // a tela mudou nesse meio-tempo: desenha tudo de novo, por segurança
    alvo.outerHTML = colFeitosHtml();
    ultimoHtml = htmlDaAba(); // mantém o cache em dia para não repintar tudo de novo na próxima atualização
  }
  // setores também chegam depois: só completa os <select> de projeto que já estão na tela
  function preencherSelectsDeSetor() {
    if (!aberta || !setoresLista) return;
    const meta = conteudo.querySelector('#selSetorMeta'), reuniao = conteudo.querySelector('#selSetorReuniao'), custo = conteudo.querySelector('#selSetorCusto');
    let mudou = false;
    if (meta && !meta.options.length) { meta.innerHTML = opcoesSetor(); mudou = true; }
    if (reuniao && !reuniao.options.length) { reuniao.innerHTML = opcoesSetor(); mudou = true; }
    if (custo && custo.options.length <= 1) { custo.insertAdjacentHTML('beforeend', opcoesSetor(x => x.id !== 'escritorio' && x.id !== 'geral')); mudou = true; }
    if (mudou) ultimoHtml = htmlDaAba();
  }
  function desenhar() {
    if (!aberta) return;
    const foco = document.activeElement;
    if (foco && conteudo.contains(foco) && /INPUT|TEXTAREA|SELECT/.test(foco.tagName) && foco.type !== 'radio') return;
    el.querySelectorAll('[data-aba]').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.aba === aba)); b.classList.toggle('ativa', b.dataset.aba === aba); });
    const av = el.querySelector('#aoVivoG');
    if (av) av.textContent = 'ao vivo · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const pos = conteudo.scrollTop;
    const html = htmlDaAba();
    if (html === ultimoHtml && aba === ultimaAba) return; // nada mudou: não mexe na tela
    ultimoHtml = html; ultimaAba = aba;
    conteudo.innerHTML = html;
    conteudo.scrollTop = pos;
    conteudo.querySelectorAll('[data-rascunho]').forEach(x => { if (rascunhos[x.dataset.rascunho] != null) x.value = rascunhos[x.dataset.rascunho]; });
    conteudo.querySelectorAll('details[data-det]').forEach(x => { if (detAbertos.has(x.dataset.det)) x.open = true; });
    if (aba === 'plano' && !relatoriosCache?.length) carregarRelatorios().then(atualizarFeitosEmPlano);
    if ((aba === 'plano' || aba === 'equipe' || aba === 'financeiro') && !setoresLista) carregarSetores().then(preencherSelectsDeSetor);
  }
})();
document.getElementById('bPainel')?.addEventListener('click', () => window.abrirPainel?.());
