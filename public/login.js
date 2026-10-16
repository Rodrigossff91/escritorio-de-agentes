const form = document.getElementById('form'), erro = document.getElementById('erro');
form.addEventListener('input', () => { erro.textContent = ''; });
form.addEventListener('submit', async e => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(form));
  if (!dados.usuario || !dados.senha) { erro.textContent = 'Preencha usuário e senha.'; return; }
  const botao = form.querySelector('button');
  botao.disabled = true; botao.textContent = 'Entrando…';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    if (r.ok) { location.href = '/'; return; }
    erro.textContent = (await r.json().catch(() => ({}))).erro || 'Não foi possível entrar.';
  } catch { erro.textContent = 'Sem conexão com o escritório.'; }
  botao.disabled = false; botao.textContent = 'Entrar';
});
