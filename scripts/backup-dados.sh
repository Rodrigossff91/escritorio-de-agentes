#!/usr/bin/env bash
# Backup diário de data/ (relatórios, conversas, agenda, projetos, login e tokens). Fica só na VPS, acesso só do root.
set -euo pipefail
RAIZ="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
DESTINO="${ESCRITORIO_BACKUP:-$HOME/backups/escritorio-agentes}"
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"
ARQ="$DESTINO/data-$(date +%F-%H%M).tar.gz"
tar -czf "$ARQ" -C "$RAIZ" data config.json especialistas
chmod 600 "$ARQ"
find "$DESTINO" -name 'data-*.tar.gz' -mtime +30 -delete
echo "backup: $ARQ ($(du -h "$ARQ" | cut -f1))"
