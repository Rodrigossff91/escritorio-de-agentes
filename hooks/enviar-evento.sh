#!/usr/bin/env bash
# Hook do Claude Code: repassa o evento ao escritório em segundo plano, sem atrasar o agente.
# Nunca escreve nada na saída (o Claude leria como contexto) e sempre sai com 0.
TOKEN_ARQ="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)/data/hook-token"
# em outra VPS: /etc/escritorio-agentes.conf define ESCRITORIO_URL, ESCRITORIO_TOKEN e ESCRITORIO_MAQUINA
[ -r /etc/escritorio-agentes.conf ] && . /etc/escritorio-agentes.conf
# resumos internos do escritório não viram robô nem relatório
[ "${ESCRITORIO_IGNORAR:-}" = "1" ] && { cat >/dev/null; exit 0; }
if [ -n "${ESCRITORIO_TOKEN:-}" ]; then token="$ESCRITORIO_TOKEN"
else [ -r "$TOKEN_ARQ" ] || { cat >/dev/null; exit 0; }; token=$(cat "$TOKEN_ARQ"); fi
payload=$(cat)
curl -s -m 5 -o /dev/null -X POST "${ESCRITORIO_URL:-http://127.0.0.1:${ESCRITORIO_PORTA:-4800}}/api/evento" -H "X-Escritorio-Maquina: ${ESCRITORIO_MAQUINA:-local}" \
  -H "Content-Type: application/json" -H "X-Escritorio-Token: $token" -H "X-Escritorio-Ordem: ${ESCRITORIO_ORDEM:-}" \
  --data-binary @- <<<"$payload" >/dev/null 2>&1 &
exit 0
