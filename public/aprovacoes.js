// Caixa de aprovações: tudo o que espera a dona num lugar só, para aprovar em sequência (ou em lote).
(() => {
  const el = document.createElement('aside');
  el.className = 'caixa';
  el.id = 'caixa';
  el.hidden = true;
  el.setAttribute('aria-label', 'Caixa de aprovações');
  document.querySelector('.palco').appendChild(el);

  let aberta = false, filtro = 'tudo', foco = 0, assinatura = '';
  const marcados = new Set(), feitos = new Set();
  const TIPOS = {
    pergunta: { rot: 'Pergunta', cor: 'var(--aviso)' }, publicacao: { rot: 'Publicação', cor: 'var(--ruim)' }, previa: { rot: 'Prévia', cor: 'var(--info)' },
    projeto: { rot: 'Plano do gerente', cor: '#534AB7' }, crescimento: { rot: 'Crescimento', cor: 'var(--bom)' }, contratacao: { rot: 'Contratação', cor: '#993556' },
    manual: { rot: 'Melhoria de manual', cor: '#5F5E5A' }, convidado: { rot: 'Convidado', cor: '#BA7517' }, entrega: { rot: 'Entrega', cor: 'var(--g-outros)' },
  };
  const FILTROS = [['tudo', 'Tudo'], ['pergunta', 'Perguntas'], ['publicacao', 'Publicar'], ['proposta', 'Propostas'], ['entrega', 'Entregas']];
  const ehProposta = t => ['projeto', 'crescimento', 'contratacao', 'manual', 'convidado', 'previa'].includes(t);
  const quando = ms => { const m = Math.round((Date.now() - ms) / 60_000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`; };

  // junta tudo o que espera a dona
  function pendencias() {
    const u = ultimo || {}, lista = [];
    for (const a of (u.agentes || []).filter(x => x.estado === 'esperando')) {
      const rel = (relatoriosCache || []).filter(r => r.sessao === a.id).sort((x, y) => y.fim - x.fim)[0];
      lista.push({ id: 'p:' + a.id, projeto: nomeSetor(a.setor), tipo: 'pergunta', t: a.desdeEstado || a.ultimoEvento || Date.now(), titulo: `${a.nome} quer falar com você`, sub: nomeSetor(a.setor), texto: rel?.simples?.pergunta || a.acao || 'precisa da sua resposta para continuar', sessao: a.id });
    }
    for (const d of (u.deploys || []).filter(x => x.status === 'aguardando')) lista.push({ id: 'd:' + d.id, projeto: nomeSetor(d.setor), tipo: 'publicacao', t: d.criado, titulo: `Publicar em ${nomeSetor(d.setor)}`, sub: `${d.agente}`, texto: d.resumo, comando: d.comando, verificar: d.verificar, ref: d.id, sessao: d.sessao, lote: true });
    for (const v of (u.previas || []).filter(x => x.status === 'ativa')) lista.push({ id: 'v:' + v.id, projeto: nomeSetor(v.setor), tipo: 'previa', t: v.criada, titulo: `Prévia de ${nomeSetor(v.setor)}`, sub: v.agente, texto: v.descricao || 'Mudança de tela', url: v.url, ref: v.id, sessao: v.sessao });
    for (const p of (u.projetos || []).filter(x => x.status === 'aguardando')) lista.push({ id: 'j:' + p.id, projeto: p.novo ? 'projeto novo' : nomeSetor(p.setor), tipo: 'projeto', t: p.criado, titulo: p.titulo, sub: 'gerente de projetos', texto: p.resumo || `${(p.tarefas || []).length} tarefa(s) planejadas`, ref: p.id, lote: true });
    for (const p of (u.propostasMelhoria || []).filter(x => x.status === 'aguardando')) lista.push({ id: 'c:' + p.id, projeto: 'Escritório', tipo: 'crescimento', t: p.criada, titulo: p.titulo, sub: `${p.tipo || 'ideia'} · ${p.tamanho || 'pequena'}`, texto: p.porque, detalhe: p.oque, ref: p.id, lote: true });
    for (const p of (u.propostasRH || []).filter(x => x.status === 'aguardando')) lista.push({ id: 'r:' + p.id, projeto: 'Equipe da empresa', tipo: 'contratacao', t: p.criada, titulo: `Contratar ${p.especialista.nome}`, sub: p.especialista.descricao, texto: p.motivo, detalhe: p.especialista.manual, ref: p.id, lote: true });
    for (const p of (u.aprendizado?.propostas || []).filter(x => x.status === 'aguardando')) lista.push({ id: 'm:' + p.id, projeto: 'Equipe da empresa', tipo: 'manual', t: p.criada || Date.now(), titulo: `${p.nome} quer melhorar o manual`, sub: `${(p.mudancas || []).length} mudança(s)`, texto: p.resumo, detalhe: (p.mudancas || []).map(x => '• ' + x).join('\n'), ref: p.id, lote: true });
    for (const c of u.convites || []) for (const p of (c.pendentes || []).filter(x => x.status === 'aguardando')) lista.push({ id: 'g:' + p.id, projeto: c.projeto, tipo: 'convidado', t: p.criado, titulo: `${c.nome} pediu (${p.modo === 'conversa' ? 'conversar' : 'executar'})`, sub: c.projeto, texto: p.pedido, ref: c.id + ':' + p.id, lote: true });
    const desde = Date.now() - 7 * 864e5;
    for (const r of (relatoriosCache || []).filter(r => !r.avaliacao && !r.rotina && r.modo !== 'conversa' && (r.arquivos || []).length && !r.simples?.pergunta && r.fim > desde))
      lista.push({ id: 'e:' + r.id, projeto: nomeSetor(r.setor), tipo: 'entrega', t: r.fim, titulo: r.simples?.titulo || curto(r.pedido, 80), sub: `${r.agente} · ${nomeSetor(r.setor)}`, texto: r.simples?.resumo || '', ref: r.id, sessao: r.sessao, lote: true });
    return lista.filter(x => !feitos.has(x.id)).sort((a, b) => (a.tipo === 'entrega') - (b.tipo === 'entrega') || ordemTipo(a.tipo) - ordemTipo(b.tipo) || a.t - b.t);
  }
  const ordemTipo = t => ['pergunta', 'publicacao', 'previa', 'convidado', 'projeto', 'contratacao', 'crescimento', 'manual', 'entrega'].indexOf(t);
  const filtrar = l => l.filter(x => filtro === 'tudo' ? x.tipo !== 'entrega' : filtro === 'proposta' ? ehProposta(x.tipo) : x.tipo === filtro);
  window.contarAprovacoes = () => pendencias().filter(x => x.tipo !== 'entrega').length;

  function botoes(x) {
    if (x.tipo === 'pergunta') return `<div class="cx-rapidas">${['Sim, pode seguir', 'Faça como você recomendou', 'Não, pare por aqui'].map(r => `<button data-cx-resp="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <form class="cx-resp"><input maxlength="4000" placeholder="Ou escreva a resposta…" aria-label="Resposta"><button type="submit" class="principal-g">Enviar</button></form>`;
    if (x.tipo === 'publicacao') return `<details><summary>Detalhes técnicos</summary><p class="cx-det"><b>Comando:</b> <code>${esc(x.comando)}</code>${x.verificar ? `<br><b>Verificação:</b> ${esc(x.verificar)}` : ''}</p></details>
      <div class="cx-acoes"><button data-cx="recusar">Cancelar</button><button data-cx="aprovar" class="principal-g">Publicar</button></div>`;
    if (x.tipo === 'previa') return `<a class="cx-link" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir a prévia</a><div class="cx-acoes"><button data-cx="recusar">Encerrar</button><button data-cx="aprovar" class="principal-g">Aprovar</button></div>`;
    if (x.tipo === 'entrega') return `<div class="cx-acoes"><button data-cx="recusar">Refazer</button><button data-cx="aprovar" class="principal-g">Aprovado</button></div>`;
    return `${x.detalhe ? `<details><summary>Ver detalhes</summary><p class="cx-det">${esc(x.detalhe)}</p></details>` : ''}<div class="cx-acoes"><button data-cx="recusar">Recusar</button><button data-cx="aprovar" class="principal-g">${x.tipo === 'contratacao' ? 'Contratar' : 'Aprovar'}</button></div>`;
  }
  function desenhar(forcar) {
    if (!aberta) return;
    const todas = pendencias(), lista = filtrar(todas);
    const sig = JSON.stringify([filtro, foco, [...marcados], lista.map(x => x.id + x.texto)]);
    if (!forcar && sig === assinatura) return;
    if (!forcar && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    assinatura = sig;
    foco = Math.min(foco, Math.max(0, lista.length - 1));
    const n = k => todas.filter(x => k === 'tudo' ? x.tipo !== 'entrega' : k === 'proposta' ? ehProposta(x.tipo) : x.tipo === k).length;
    const sel = lista.filter(x => marcados.has(x.id) && x.lote);
    el.innerHTML = `<header class="cx-topo"><div class="cx-linha"><h2>Esperando você</h2><span class="cx-total">${n('tudo')}</span>
        <button class="cx-fechar" data-cx-acao="fechar" aria-label="Fechar">×</button></div>
      <div class="cx-filtros">${FILTROS.map(([k, r]) => `<button data-cx-filtro="${k}" class="${filtro === k ? 'ativo' : ''}">${r}${n(k) ? ` <span>${n(k)}</span>` : ''}</button>`).join('')}</div>
      ${lista.some(x => x.lote) ? `<div class="cx-lote"><label><input type="checkbox" data-cx-acao="todos" ${sel.length && sel.length === lista.filter(x => x.lote).length ? 'checked' : ''}> marcar todos</label>
        ${sel.length ? `<button data-cx-acao="lote-recusar">Recusar ${sel.length}</button><button data-cx-acao="lote-aprovar" class="principal-g">Aprovar ${sel.length}</button>` : '<small>↑↓ andar · A aprova · R recusa · espaço marca</small>'}</div>` : ''}</header>
      <div class="cx-lista">${lista.length ? lista.map((x, i) => `<article class="cx-item${i === foco ? ' foco' : ''}${marcados.has(x.id) ? ' marcado' : ''}" data-cx-id="${esc(x.id)}" style="--c:${TIPOS[x.tipo].cor}" tabindex="-1">
          <div class="cx-cab">${x.lote ? `<input type="checkbox" data-cx-marcar ${marcados.has(x.id) ? 'checked' : ''} aria-label="Marcar">` : ''}<span class="cx-proj">${esc(x.projeto || '')}</span><span class="cx-tipo">${TIPOS[x.tipo].rot}</span><small>${esc(x.sub || '')} · ${esc(quando(x.t))}</small>
            ${x.sessao ? `<button class="cx-abrir" data-cx-abrir="${esc(x.sessao)}">abrir conversa</button>` : ''}</div>
          <b>${esc(x.titulo)}</b>${x.texto ? `<p>${esc(curto(x.texto, 600))}</p>` : ''}${botoes(x)}</article>`).join('')
        : `<div class="cx-vazio"><b>Tudo em dia!</b><p>Nada esperando você${filtro === 'tudo' ? '' : ' nesta aba'}.</p></div>`}</div>`;
    el.querySelector('.cx-item.foco')?.scrollIntoView({ block: 'nearest' });
  }

  async function agir(x, aprovar, texto) {
    const r = await (async () => {
      switch (x.tipo) {
        case 'pergunta': return postar('/api/ordens', { sessao: x.sessao, pedido: texto, modo: 'executar' });
        case 'publicacao': return postar(`/api/deploys/${x.ref}/${aprovar ? 'publicar' : 'cancelar'}`);
        case 'previa':
          if (aprovar && x.sessao) await postar('/api/ordens', { sessao: x.sessao, pedido: `A dona viu a prévia (${x.url}) e APROVOU. Finalize o trabalho (commit, se for o caso) e, se for para produção, prepare a publicação com escritorio-publicar.`, modo: 'executar' });
          return postar(`/api/previas/${x.ref}/encerrar`);
        case 'projeto': return postar(`/api/projetos/${x.ref}/${aprovar ? 'aprovar' : 'cancelar'}`);
        case 'crescimento': return postar(`/api/melhorias/${x.ref}/${aprovar ? 'aprovar' : 'recusar'}`, { motivo: texto || '' });
        case 'contratacao': return postar(`/api/rh/${x.ref}/${aprovar ? 'aprovar' : 'recusar'}`);
        case 'manual': return postar(`/api/aprendizado/${x.ref}/${aprovar ? 'aprovar' : 'recusar'}`);
        case 'convidado': { const [c, p] = x.ref.split(':'); return postar(`/api/convites/${c}/pedidos/${p}/${aprovar ? 'aprovar' : 'recusar'}`); }
        case 'entrega': return postar(`/api/relatorios/${x.ref}/avaliar`, aprovar ? { avaliacao: 'aprovado' } : { avaliacao: 'refazer', comentario: texto || 'Refazer (pedido pela caixa de aprovações).' });
      }
    })();
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { aviso(j.erro || 'Não deu certo.', null, [330]); return false; }
    feitos.add(x.id); marcados.delete(x.id);
    return true;
  }
  async function decidir(x, aprovar) {
    if (!x) return;
    let texto = '';
    if (x.tipo === 'pergunta') return;
    if (!aprovar && x.tipo === 'entrega') { texto = prompt('O que precisa mudar?') || ''; if (!texto) return; }
    if (aprovar && x.tipo === 'publicacao' && !confirm(`Publicar em produção?\n\n${x.texto}\n\nO DevOps confere tudo antes de publicar.`)) return;
    if (await agir(x, aprovar, texto)) { aviso(aprovar ? `${TIPOS[x.tipo].rot}: aprovado.` : `${TIPOS[x.tipo].rot}: recusado.`, null, aprovar ? [523, 659] : [330]); desenhar(true); }
  }

  function abrir(sim, comFiltro) {
    aberta = sim; el.hidden = !sim;
    if (comFiltro) filtro = comFiltro;
    if (sim) { if (!relatoriosCache?.length) carregarRelatorios().then(() => desenhar(true)); desenhar(true); }
  }
  window.abrirAprovacoes = (f) => abrir(true, f);
  window.aprovacoesAtualizar = () => desenhar();

  el.addEventListener('click', async e => {
    const lista = filtrar(pendencias());
    const art = e.target.closest('[data-cx-id]'), x = art && lista.find(i => i.id === art.dataset.cxId);
    if (art) foco = lista.indexOf(x);
    const f = e.target.closest('[data-cx-filtro]');
    if (f) { filtro = f.dataset.cxFiltro; foco = 0; marcados.clear(); return desenhar(true); }
    const ac = e.target.closest('[data-cx-acao]')?.dataset.cxAcao;
    if (ac === 'fechar') return abrir(false);
    if (ac === 'todos') { const lote = lista.filter(i => i.lote); const todos = lote.every(i => marcados.has(i.id)); lote.forEach(i => todos ? marcados.delete(i.id) : marcados.add(i.id)); return desenhar(true); }
    if (ac === 'lote-aprovar' || ac === 'lote-recusar') {
      const aprovar = ac === 'lote-aprovar', sel = lista.filter(i => marcados.has(i.id) && i.lote);
      if (!sel.length) return;
      if (sel.some(i => i.tipo === 'entrega') && !aprovar) return aviso('Para refazer entregas, faça uma por vez (precisa dizer o que mudar).');
      const pubs = sel.filter(i => i.tipo === 'publicacao');
      if (!confirm(`${aprovar ? 'Aprovar' : 'Recusar'} ${sel.length} item(ns)?${pubs.length && aprovar ? `\n\nInclui ${pubs.length} publicação(ões) em produção:\n- ${pubs.map(p => curto(p.texto, 80)).join('\n- ')}` : ''}`)) return;
      let ok = 0;
      for (const i of sel) if (await agir(i, aprovar, '')) ok++;
      aviso(`${ok} de ${sel.length} ${aprovar ? 'aprovado(s)' : 'recusado(s)'}.`, null, [523, 659, 784]);
      return desenhar(true);
    }
    if (e.target.closest('[data-cx-marcar]')) { if (x) { marcados.has(x.id) ? marcados.delete(x.id) : marcados.add(x.id); } return desenhar(true); }
    const ab = e.target.closest('[data-cx-abrir]');
    if (ab) { const a = avatares.get(ab.dataset.cxAbrir); abrir(false); if (a) abrirChatAgente(a); else abrirPapelada(ab.dataset.cxAbrir); return; }
    const rp = e.target.closest('[data-cx-resp]');
    if (rp && x) { if (await agir(x, true, rp.dataset.cxResp)) { aviso('Resposta enviada. Ele continua de onde parou.', null, [523, 659]); desenhar(true); } return; }
    const b = e.target.closest('[data-cx]');
    if (b && x) { b.disabled = true; await decidir(x, b.dataset.cx === 'aprovar'); b.disabled = false; }
  });
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const art = e.target.closest('[data-cx-id]'), x = art && pendencias().find(i => i.id === art.dataset.cxId), inp = e.target.querySelector('input');
    if (!x || !inp.value.trim()) return inp.focus();
    if (await agir(x, true, inp.value.trim())) { aviso('Resposta enviada. Ele continua de onde parou.', null, [523, 659]); desenhar(true); }
  });
  addEventListener('keydown', e => {
    const digitando = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey;
    if (!aberta) { if (!digitando && (e.key === 'a' || e.key === 'A') && !papeladaAberta && !extraAberto) { e.preventDefault(); abrir(true); } return; }
    if (digitando) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    const lista = filtrar(pendencias()), x = lista[foco];
    if (e.key === 'Escape') { abrir(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); foco = Math.min(foco + 1, lista.length - 1); desenhar(true); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); foco = Math.max(foco - 1, 0); desenhar(true); }
    else if (e.key === ' ' && x?.lote) { e.preventDefault(); marcados.has(x.id) ? marcados.delete(x.id) : marcados.add(x.id); desenhar(true); }
    else if ((e.key === 'a' || e.key === 'A') && x) { e.preventDefault(); if (x.tipo === 'pergunta') el.querySelector('.cx-item.foco input')?.focus(); else decidir(x, true); }
    else if ((e.key === 'r' || e.key === 'R') && x && x.tipo !== 'pergunta') { e.preventDefault(); decidir(x, false); }
  });
})();
