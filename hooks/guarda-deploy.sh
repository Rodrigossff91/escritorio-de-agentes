#!/usr/bin/env bash
# Guarda do escritório (PreToolUse/Bash): agentes de tarefas do escritório não publicam em produção sozinhos.
# Só vale dentro de tarefas do escritório (ESCRITORIO_ORDEM); as sessões normais do app não são afetadas.
# Sai com 2 para bloquear: o motivo vai para o agente pelo stderr.
payload=$(cat)
[ -z "${ESCRITORIO_ORDEM:-}" ] && exit 0
[ "${ESCRITORIO_DEPLOY_AUTORIZADO:-}" = "1" ] && exit 0
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0
case "$cmd" in escritorio-publicar*|escritorio-previa*) exit 0 ;; esac
if printf '%s' "$cmd" | grep -Eiq '(^|[;&|(]|\s)(git\s+push|vercel\b[^;&|]*--prod|coolify|docker\s+(push|stack\s+deploy)|docker[ -]compose\b[^;&|]*\bup\b|systemctl\s+(restart|reload|stop|start)|kubectl\s+(apply|rollout|delete)|fly\s+deploy|(npm|pnpm|yarn)\s+(run\s+)?deploy|[a-z0-9_./-]*deploy[a-z0-9_.-]*\.sh)'; then
  echo "Bloqueado pelo escritório: publicar em produção precisa do botão Publicar da dona. Prepare tudo e registre o pedido com: escritorio-publicar \"<comando exato de deploy>\" \"<o que vai ao ar, em português simples>\" \"<como verificar depois>\". Depois pare e avise no seu resumo final." >&2
  exit 2
fi
exit 0
