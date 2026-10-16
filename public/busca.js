// Busca geral (Ctrl+K): procura em tudo e executa ações.
// Ex.: "devops ver o certificado do site" manda direto para o DevOps; o nome de um projeto abre o projeto.
(() => {
  const caixa = document.createElement('div');
  caixa.className = 'busca-geral';
  caixa.hidden = true;
  caixa.innerHTML = `<div class="bg-fundo" data-fechar></div>
    <div class="bg-janela" role="dialog" aria-modal="true" aria-label="Busca geral">
      <div class="bg-topo"><span class="bg-lupa" aria-hidden="true">⌕</span>
        <input id="bgTexto" autocomplete="off" spellcheck="false" placeholder="Procure ou peça algo… ex.: “devops ver o certificado do site”, “nome do projeto”, “ideia: …”">
        <button type="button" id="bgMic" class="bg-mic" title="Falar o pedido" aria-label="Falar o pedido" hidden>🎤</button>
        <kbd>Esc</kbd></div>
      <div class="bg-lista" id="bgLista" role="listbox"></div>
      <div class="bg-rodape"><label>Projeto das ações <select id="bgSetor"></select></label><span><kbd>↑</kbd><kbd>↓</kbd> escolher · <kbd>Enter</kbd> fazer</span></div>
    </div>`;
  document.body.appendChild(caixa);
  const entrada = caixa.querySelector('#bgTexto'), listaEl = caixa.querySelector('#bgLista'), selSetor = caixa.querySelector('#bgSetor'), botaoMic = caixa.querySelector('#bgMic');
  let itens = [], sel = 0, conversasAchadas = [], timer = null, setores = null, ultimaQ = '';

  // microfone: só aparece se o navegador tiver a API de reconhecimento de fala
  const MotorFala = window.SpeechRecognition || window.webkitSpeechRecognition;
  let reconhecimento = null, ouvindo = false;
  function pararEscuta() { ouvindo = false; botaoMic.classList.remove('ouvindo'); botaoMic.title = 'Falar o pedido'; }
  if (MotorFala) {
    botaoMic.hidden = false;
    reconhecimento = new MotorFala();
    reconhecimento.lang = 'pt-BR';
    reconhecimento.interimResults = false;
    reconhecimento.maxAlternatives = 1;
    reconhecimento.onresult = e => {
      const texto = e.results?.[0]?.[0]?.transcript?.trim();
      if (texto) { entrada.value = texto; sel = 0; montar(); entrada.focus(); }
    };
    reconhecimento.onerror = pararEscuta;
    reconhecimento.onend = pararEscuta;
    botaoMic.addEventListener('click', () => {
      if (ouvindo) { reconhecimento.stop(); return; }
      try { reconhecimento.start(); ouvindo = true; botaoMic.classList.add('ouvindo'); botaoMic.title = 'Ouvindo… toque para parar'; }
      catch { /* já estava ouvindo ou sem permissão */ }
    });
  }

  const norm = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const contaPadrao = () => { try { return localStorage.getItem('escritorio-conta') || 'pessoal'; } catch { return 'pessoal'; } };
  const setorAtual = () => selSetor.value || 'geral';

  async function abrirBusca() {
    caixa.hidden = false;
    entrada.value = ''; conversasAchadas = []; sel = 0;
    if (!setores) { try { const r = await fetch('/api/setores'); setores = r.ok ? await r.json() : []; } catch { setores = []; } }
    selSetor.innerHTML = setores.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
    try { const u = localStorage.getItem('painel-setor'); if (u && setores.some(x => x.id === u)) selSetor.value = u; } catch { /* ignora */ }
    montar(); entrada.focus();
  }
  function fecharBusca() { caixa.hidden = true; if (ouvindo) reconhecimento.stop(); }
  window.abrirBusca = abrirBusca;

  // lê "mandar para devops: texto", "devops texto", "pro kauã texto"
  function pedidoPara(q) {
    const limpa = q.replace(/^(mandar|pedir|perguntar|falar)\s+(para|pra|pro|ao|a|com)\s+/i, '').replace(/^(pra|pro|para)\s+/i, '');
    const n = norm(limpa);
    for (const e of ultimo?.especialidades || []) {
      const apelido = avatares.get('fixo:' + e.id)?.nome || '';
      for (const chave of [e.id, norm(e.nome), norm(apelido)].filter(x => x && x.length >= 3)) {
        if (n.startsWith(chave + ' ') || n.startsWith(chave + ':')) {
          const texto = limpa.slice(chave.length).replace(/^[\s:,-]+/, '').trim();
          if (texto.length >= 3) return { esp: e, apelido, texto };
        }
      }
    }
    return null;
  }

  function montar() {
    const q = entrada.value.trim(), nq = norm(q), achou = t => !nq || norm(t).includes(nq);
    const lista = [];
    // ações a partir do que foi escrito
    const ideia = q.match(/^ideia\s*:?\s*(.+)/i);
    const pp = q.length >= 4 && pedidoPara(q);
    if (ideia) lista.push({ grupo: 'Ação', titulo: `Guardar ideia: “${ideia[1]}”`, sub: 'vai para Planejamento › Ideias', faz: () => acao('/api/ideias', { titulo: ideia[1], setor: setorAtual() }, 'Ideia guardada.') });
    if (pp) lista.push({ grupo: 'Ação', titulo: `Mandar para ${pp.apelido || pp.esp.nome} (${pp.esp.nome}): “${pp.texto}”`, sub: `projeto: ${nomeDe(setorAtual())} · ele executa`, destaque: true,
      faz: () => acao('/api/ordens', { setor: setorAtual(), pedido: pp.texto, papel: pp.esp.id, conta: contaPadrao(), modo: 'executar' }, `Mandado para ${pp.apelido || pp.esp.nome}.`) });

    // atalhos
    const atalhos = [
      ['Abrir painel', 'gráficos e números do dia', () => window.abrirPainel?.('geral')],
      ['Planejamento: metas e ideias', 'painel', () => window.abrirPainel?.('plano')],
      ['Publicações', 'histórico do que foi ao ar', () => window.abrirPainel?.('publicacoes')],
      ['Atividade das últimas 48h', 'painel', () => window.abrirPainel?.('atividade')],
      ['Infra e servidores', 'painel', () => window.abrirPainel?.('infra')],
      ['Conversas', 'todas as conversas com os agentes', () => abrirPapelada()],
      ['Agenda', 'tarefas agendadas', () => abrirExtra('agenda')],
      ['Consumo', 'uso da assinatura', () => abrirExtra('consumo')],
      ['Projetos com o gerente', 'criar e acompanhar projetos', () => abrirExtra('projetos')],
      ['Resumo da manhã agora', 'ontem, o que espera você e o plano de hoje', async () => { await postar('/api/rotinas/resumo/rodar'); abrirPapelada('resumo-da-manha'); }],
    ];
    for (const [t, sub, faz] of atalhos) if (nq && achou(t)) lista.push({ grupo: 'Ir para', titulo: t, sub, faz });
    // agentes trabalhando ou esperando
    for (const a of (ultimo?.agentes || []).filter(a => a.estado !== 'saiu')) if (nq && (achou(a.nome) || achou(a.pedido)))
      lista.push({ grupo: 'Agentes', titulo: `${a.nome} · ${nomeDe(a.setor)}`, sub: a.estado === 'trabalhando' ? 'trabalhando agora' : a.estado === 'esperando' ? 'esperando você' : 'de folga', faz: () => abrirAgente(a.id) });
    // especialistas
    for (const e of ultimo?.especialidades || []) {
      const ap = avatares.get('fixo:' + e.id)?.nome || '';
      if (nq && !pp && (achou(e.nome) || achou(ap) || achou(e.id) || achou(e.descricao)))
        lista.push({ grupo: 'Especialistas', titulo: `Conversar com ${ap || e.nome}`, sub: `${e.nome}${e.descricao ? ' · ' + e.descricao : ''}`, faz: () => abrirAgente('fixo:' + e.id) });
    }
    // projetos
    for (const st of setores || []) if (nq && achou(st.nome))
      lista.push({ grupo: 'Projetos', titulo: `Abrir ${st.nome}`, sub: 'vai até a sala e mostra a ficha do projeto', faz: () => irProjeto(st.id) });
    // ideias e metas
    for (const i of (ultimo?.ideias || []).filter(i => i.status !== 'mandada')) if (nq && achou(i.titulo)) lista.push({ grupo: 'Ideias', titulo: i.titulo, sub: `${nomeDe(i.setor)} · prioridade ${i.prioridade}`, faz: () => window.abrirPainel?.('plano') });
    for (const m of ultimo?.metas || []) if (nq && achou(m.titulo)) lista.push({ grupo: 'Metas', titulo: m.titulo, sub: `${nomeDe(m.setor)}${m.prazo ? ' · prazo ' + m.prazo.split('-').reverse().join('/') : ''}`, faz: () => window.abrirPainel?.('plano') });
    // conversas (busca no servidor)
    for (const c of conversasAchadas) lista.push({ grupo: 'Conversas', titulo: `${c.agente} · ${nomeDe(c.setor)}`, sub: c.titulo || c.trecho || '', faz: () => abrirPapelada(c.conversa) });
    // pedido livre para a equipe: só quando parece um pedido (3+ palavras) e sempre no fim, para um Enter não mandar sem querer
    if (q.split(/\s+/).length >= 3 && !ideia && !pp) {
      lista.push({ grupo: 'Pedir para a equipe', titulo: `Mandar para a equipe: “${q}”`, sub: `projeto: ${nomeDe(setorAtual())} · o escritório escolhe o especialista`, destaque: true,
        faz: () => acao('/api/ordens', { setor: setorAtual(), pedido: q, conta: contaPadrao(), modo: 'executar' }, 'Pedido enviado para a equipe.') });
      lista.push({ grupo: 'Pedir para a equipe', titulo: `Guardar como ideia: “${q}”`, sub: 'para mandar depois', faz: () => acao('/api/ideias', { titulo: q, setor: setorAtual() }, 'Ideia guardada.') });
    }
    if (!nq) {
      const esp = (ultimo?.agentes || []).filter(a => a.estado === 'esperando');
      for (const a of esp) lista.push({ grupo: 'Esperando você', titulo: a.nome, sub: nomeDe(a.setor), faz: () => abrirAgente(a.id) });
      for (const [t, sub, faz] of atalhos.slice(0, 6)) lista.push({ grupo: 'Ir para', titulo: t, sub, faz });
    }
    itens = lista.slice(0, 40);
    sel = Math.min(sel, Math.max(0, itens.length - 1));
    let grupo = '';
    listaEl.innerHTML = itens.length ? itens.map((it, i) => {
      const cab = it.grupo !== grupo ? `<div class="bg-grupo">${esc(it.grupo)}</div>` : '';
      grupo = it.grupo;
      return `${cab}<div class="bg-item ${i === sel ? 'sel' : ''} ${it.destaque ? 'destaque' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}"><b>${esc(it.titulo)}</b>${it.sub ? `<small>${esc(curto(it.sub, 140))}</small>` : ''}</div>`;
    }).join('') : `<div class="bg-vazio">Nada encontrado. Escreva um pedido completo para mandar para a equipe.</div>`;
    listaEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  const nomeDe = id => (setores || []).find(x => x.id === id)?.nome || (ultimo?.setores || []).find(x => x.id === id)?.nome || id;
  async function acao(url, corpo, ok) {
    const r = await postar(url, corpo), j = await r.json().catch(() => ({}));
    aviso(r.ok ? ok : (j.erro || 'Não deu certo.'), null, r.ok ? [523, 659] : [330]);
  }
  function abrirAgente(chave) {
    const a = avatares.get(chave);
    if (a) abrirChatAgente(a); else abrirPapelada(chave);
  }
  function irProjeto(id) {
    const s = salas.get(id);
    if (s) { vista.alvoFoco.set(s.cx, 0, s.cz); vista.alvoZoom = 2.6; }
    window.abrirPainel?.('projetos');
  }
  function executar(i) {
    const it = itens[i];
    if (!it) return;
    fecharBusca();
    try { localStorage.setItem('painel-setor', setorAtual()); } catch { /* ignora */ }
    Promise.resolve(it.faz()).catch(() => aviso('Não deu certo.', null, [330]));
  }

  entrada.addEventListener('input', () => {
    sel = 0; montar();
    clearTimeout(timer);
    const q = entrada.value.trim();
    if (q.length < 3) { conversasAchadas = []; return; }
    timer = setTimeout(async () => {
      ultimaQ = q;
      try {
        const r = await fetch('/api/busca?q=' + encodeURIComponent(q));
        const res = r.ok ? await r.json() : [];
        if (ultimaQ !== entrada.value.trim()) return;
        const vistas = new Set();
        conversasAchadas = res.filter(x => !vistas.has(x.conversa) && vistas.add(x.conversa)).slice(0, 8)
          .map(x => ({ conversa: x.conversa, agente: x.agente, setor: x.setor, titulo: x.titulo, trecho: x.trecho }));
        montar();
      } catch { /* sem busca */ }
    }, 250);
  });
  entrada.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, itens.length - 1); montar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); montar(); }
    else if (e.key === 'Enter') { e.preventDefault(); executar(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); fecharBusca(); }
  });
  selSetor.addEventListener('change', montar);
  listaEl.addEventListener('mousemove', e => { const it = e.target.closest('[data-i]'); if (it && Number(it.dataset.i) !== sel) { sel = Number(it.dataset.i); listaEl.querySelectorAll('.bg-item').forEach(x => x.classList.toggle('sel', Number(x.dataset.i) === sel)); } });
  listaEl.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) executar(Number(it.dataset.i)); });
  caixa.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) fecharBusca(); });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); caixa.hidden ? abrirBusca() : fecharBusca(); }
  });
  document.getElementById('bBusca')?.addEventListener('click', abrirBusca);
})();
