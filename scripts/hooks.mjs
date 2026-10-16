// Instala ou remove os hooks do escritório nas contas do Claude Code, com backup antes.
// Uso: node scripts/hooks.mjs instalar|remover
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
// uma pasta de configuração por conta do Claude ('' = a padrão, ~/.claude)
const CONTAS = [...new Set(Object.values(config.contas || { pessoal: '' }).map(d => path.join(d || path.join(os.homedir(), '.claude'), 'settings.json')))];
const COMANDO = path.join(RAIZ, 'hooks', 'enviar-evento.sh');
// guarda síncrono: impede tarefas do escritório de publicarem em produção sem o botão da dona
const GUARDA = path.join(RAIZ, 'hooks', 'guarda-deploy.sh');
// guarda das regras: projetos protegidos só mudam quando a dona manda a tarefa para eles
const REGRAS = path.join(RAIZ, 'hooks', 'guarda-regras.sh');
const EVENTOS = {
  SessionStart: null, SessionEnd: null, UserPromptSubmit: null, PreToolUse: null,
  PostToolUse: 'Task|Agent|Bash', Notification: null, Stop: null, SubagentStop: null,
};
const acao = process.argv[2];
if (!['instalar', 'remover'].includes(acao)) { console.error('Uso: node scripts/hooks.mjs instalar|remover'); process.exit(1); }

for (const arq of CONTAS) {
  if (!fs.existsSync(arq)) { console.log(`- ${arq}: não existe, pulando`); continue; }
  const original = fs.readFileSync(arq, 'utf8');
  const cfg = JSON.parse(original);
  cfg.hooks ||= {};
  for (const [evento, matcher] of Object.entries(EVENTOS)) {
    const grupos = (cfg.hooks[evento] || [])
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => h.command !== COMANDO && h.command !== GUARDA && h.command !== REGRAS) }))
      .filter(g => g.hooks.length);
    if (acao === 'instalar') {
      const g = { hooks: [{ type: 'command', command: COMANDO, timeout: 5 }] };
      if (matcher) g.matcher = matcher;
      grupos.push(g);
      if (evento === 'PreToolUse') grupos.push({ matcher: 'Bash', hooks: [{ type: 'command', command: GUARDA, timeout: 10 }] });
      if (evento === 'PreToolUse') grupos.push({ matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [{ type: 'command', command: REGRAS, timeout: 10 }] });
    }
    if (grupos.length) cfg.hooks[evento] = grupos; else delete cfg.hooks[evento];
  }
  const novo = JSON.stringify(cfg, null, 2) + '\n';
  if (novo === original) { console.log(`- ${arq}: nada a mudar`); continue; }
  const backup = `${arq}.bak-escritorio-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(backup, original);
  fs.writeFileSync(arq + '.tmp', novo);
  fs.renameSync(arq + '.tmp', arq);
  console.log(`- ${arq}: ${acao === 'instalar' ? 'hooks instalados' : 'hooks removidos'} (backup em ${backup})`);
}
