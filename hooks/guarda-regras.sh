#!/usr/bin/env bash
# Guarda das regras da dona (PreToolUse: Edit, Write, MultiEdit, NotebookEdit e Bash).
# Projetos protegidos só podem ser ALTERADOS por tarefas do escritório que a dona mandou para aquele projeto.
# Só vale dentro de tarefas do escritório (ESCRITORIO_ORDEM); as sessões normais do app não são afetadas.
# Sai com 2 para bloquear: o motivo vai para o agente pelo stderr. Ler continua liberado.
payload=$(cat)
[ -z "${ESCRITORIO_ORDEM:-}" ] && exit 0
RAIZ="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
PROT="$RAIZ/data/protecao.json"
[ -r "$PROT" ] || exit 0
command -v jq >/dev/null || exit 0

ferramenta=$(printf '%s' "$payload" | jq -r '.tool_name // empty')
arquivo=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
comando=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty')
setor="${ESCRITORIO_SETOR:-}"
origem="${ESCRITORIO_ORIGEM:-}"

# origens que contam como "a dona mandou"
case "$origem" in painel|ideia|meta|agenda|publicar|qa|refazer|projeto) dona=1 ;; *) dona=0 ;; esac

# comandos só de leitura não são bloqueados
somente_leitura() {
  printf '%s' "$1" | grep -Eqv '(>|\btee\b|\brm\b|\bmv\b|\bcp\b|sed\s+-i|\bchmod\b|\bchown\b|\bmkdir\b|\btouch\b|\bln\b|git\s+(commit|push|add|reset|checkout|merge|rebase|stash|apply|pull)|\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|run|update)|prisma\s+(migrate|db)|\bdocker\b|\bsystemctl\b|\bkill\b|\bpsql\b.*-c|\btruncate\b|\bdd\b|\bpatch\b|python3?\s|\bnode\s+[^-])'
}

n=$(jq 'length' "$PROT")
for ((i = 0; i < n; i++)); do
  id=$(jq -r ".[$i].setor" "$PROT"); nome=$(jq -r ".[$i].nome" "$PROT")
  # a dona mandou ESTA tarefa para ESTE projeto: liberado
  [ "$dona" = 1 ] && [ "$setor" = "$id" ] && continue
  while IFS= read -r pasta; do
    [ -z "$pasta" ] && continue
    alvo=0
    case "$ferramenta" in
      Edit|Write|MultiEdit|NotebookEdit)
        [ -n "$arquivo" ] && case "$arquivo" in "$pasta"|"$pasta"/*) alvo=1 ;; esac ;;
      Bash)
        if ! somente_leitura "$comando"; then
          case "$comando" in *"$pasta"*) alvo=1 ;; esac
          case "$cwd" in "$pasta"|"$pasta"/*) alvo=1 ;; esac
        fi ;;
    esac
    if [ "$alvo" = 1 ]; then
      echo "Bloqueado pelas regras do escritório: o projeto $nome está protegido e só pode ser alterado quando a dona manda uma tarefa para ele. Você pode ler os arquivos, mas não alterar. Se for necessário mexer nele, pare e explique no resumo final o que precisaria ser feito, para a dona decidir." >&2
      exit 2
    fi
  done < <(jq -r ".[$i].pastas[]" "$PROT")
done
exit 0
