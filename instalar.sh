#!/usr/bin/env bash
# Instalador do Escritório de Agentes. Rode dentro da pasta do projeto:  ./instalar.sh
# Pergunta o básico, cria o config.json, a senha, liga os ganchos do Claude Code e (se puder) o serviço.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
RAIZ="$(pwd)"
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$*"; }
erro() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
pergunta() { local r; read -r -p "$1 [$2]: " r; echo "${r:-$2}"; }

echo; verde "Escritório de Agentes · instalação"; echo

# 1. o que precisa ter
command -v node >/dev/null || erro "Precisa do Node.js 20 ou mais novo (https://nodejs.org)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || erro "Seu Node é antigo. Instale a versão 20 ou mais nova."
command -v claude >/dev/null || erro "Precisa do Claude Code instalado (https://docs.claude.com/claude-code) e logado com a sua assinatura."
for c in curl jq; do command -v "$c" >/dev/null || erro "Falta o programa '$c'. Instale com o gerenciador de pacotes do sistema (ex.: sudo apt install $c)."; done
if command -v systemd-run >/dev/null; then TEM_SYSTEMD=1; else TEM_SYSTEMD=0; amarelo "Sem systemd: o escritório abre e mostra os agentes, mas mandar tarefas pelo escritório só funciona em Linux com systemd."; fi
command -v docker >/dev/null || amarelo "Sem Docker: a sala do datacenter vai ficar vazia (é opcional)."

# 2. config.json
if [ -f config.json ]; then
  amarelo "Já existe um config.json: vou manter o seu."
else
  EMPRESA=$(pergunta "Nome da sua empresa" "Minha Empresa")
  RAIZP=$(pergunta "Pasta onde ficam seus projetos" "$HOME/projetos")
  [ -d "$RAIZP" ] || erro "A pasta $RAIZP não existe."
  echo "Projetos encontrados em $RAIZP (cada um vira uma sala do escritório):"
  ls -1d "$RAIZP"/*/ 2>/dev/null | sed 's#/$##' | xargs -n1 basename | sed 's/^/  - /' || true
  ESCOLHA=$(pergunta "Quais entram? (nomes separados por vírgula, ou 'todos')" "todos")
  CIDADE_LAT=$(pergunta "Latitude da sua cidade para a chuva no escritório (vazio = sem clima)" "")
  CIDADE_LON=""; [ -n "$CIDADE_LAT" ] && CIDADE_LON=$(pergunta "Longitude" "")
  EMPRESA="$EMPRESA" RAIZP="$RAIZP" ESCOLHA="$ESCOLHA" LAT="$CIDADE_LAT" LON="$CIDADE_LON" ESC="$RAIZ" node --input-type=module -e '
    import fs from "node:fs"; import path from "node:path"; import os from "node:os";
    const c = JSON.parse(fs.readFileSync("config.exemplo.json", "utf8"));
    const cores = ["#D85A30", "#185FA5", "#0F6E56", "#854F0B", "#534AB7", "#993556", "#3B6D11", "#A32D2D", "#0C447C", "#5F5E5A"];
    const raiz = process.env.RAIZP, escolha = process.env.ESCOLHA.trim();
    let pastas = fs.readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name);
    if (escolha !== "todos") { const q = escolha.split(",").map(s => s.trim()).filter(Boolean); pastas = pastas.filter(p => q.includes(p)); }
    const slug = t => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "projeto";
    c.empresa = process.env.EMPRESA;
    c.raizProjetos = raiz;
    c.setores = [
      { id: "geral", nome: `${process.env.EMPRESA} (geral)`, cor: "#085041", pastas: [raiz] },
      ...pastas.slice(0, 16).map((p, i) => ({ id: slug(p), nome: p, cor: cores[i % cores.length], pastas: [path.join(raiz, p)] })),
      { id: "escritorio", nome: "Escritório", cor: "#444441", pastas: [process.env.ESC] },
    ];
    if (process.env.LAT && process.env.LON) c.clima = { lat: Number(process.env.LAT), lon: Number(process.env.LON) };
    c.backupEscritorio = path.join(os.homedir(), "backups", "escritorio-agentes");
    fs.writeFileSync("config.json", JSON.stringify(c, null, 2) + "\n");
    console.log(`config.json criado com ${pastas.length} projeto(s).`);
  '
fi
[ -f especialistas/_empresa.md ] || cp especialistas/_empresa.modelo.md especialistas/_empresa.md

# 3. senha de acesso
if [ -f data/auth.json ]; then amarelo "Senha já definida (para trocar: node scripts/definir-senha.mjs)."; else verde "Crie o usuário e a senha para entrar no escritório:"; node scripts/definir-senha.mjs; fi

# 4. ganchos do Claude Code (é o que faz os agentes aparecerem)
R=$(pergunta "Ligar o escritório ao seu Claude Code agora? (faz backup do settings.json antes) s/n" "s")
if [ "$R" = "s" ]; then node scripts/hooks.mjs instalar; else amarelo "Depois rode: node scripts/hooks.mjs instalar"; fi

# 5. comandos que os agentes usam para pedir publicação e prévia
if [ -w /usr/local/bin ]; then
  ln -sf "$RAIZ/hooks/escritorio-publicar" /usr/local/bin/escritorio-publicar
  ln -sf "$RAIZ/hooks/escritorio-previa" /usr/local/bin/escritorio-previa
else amarelo "Sem permissão em /usr/local/bin: os agentes não terão os comandos escritorio-publicar e escritorio-previa (opcional)."; fi

# 6. serviço (liga sozinho com a máquina)
if [ "$TEM_SYSTEMD" = 1 ] && [ "$(id -u)" = 0 ]; then
  R=$(pergunta "Instalar como serviço do sistema (liga sozinho)? s/n" "s")
  if [ "$R" = "s" ]; then
    sed -e "s#@RAIZ@#$RAIZ#g" -e "s#@NODE@#$(command -v node)#g" -e "s#@PROJETOS@#$(node -p 'require("./config.json").raizProjetos')#g" escritorio-agentes.service.modelo > /etc/systemd/system/escritorio-agentes.service
    systemctl daemon-reload && systemctl enable --now escritorio-agentes
    verde "Serviço ligado."
  fi
else
  amarelo "Para ligar: node server.mjs   (ou instale como serviço rodando este instalador como root)"
fi

echo; verde "Pronto! Abra http://127.0.0.1:4800 e entre com o usuário e a senha que você criou."
echo "Para acessar de outro aparelho com segurança, use o Tailscale (veja o README)."
