# Escritório de Agentes

Um escritório em 3D para **ver e comandar os agentes do Claude Code** trabalhando nos seus projetos.
Cada projeto vira uma sala, cada sessão do Claude vira um robô na mesa, e você conversa com eles por um chat,
acompanha tudo num painel e aprova o que vai para produção com um botão.

![O escritório](docs/escritorio.jpg)

📖 **[Guia completo: como instalar e usar](COMO-USAR.md)**

> Projeto independente, feito com o Claude Code. Não é um produto oficial da Anthropic.

| Agentes trabalhando | Chat com um agente |
| --- | --- |
| ![Agentes trabalhando](docs/agentes-trabalhando.jpg) | ![Chat com um agente](docs/chat-com-agente.jpg) |

## O que ele faz

- **Escritório ao vivo em 3D:** os robôs andam, sentam na mesa do projeto quando trabalham, vão até a diretoria
  quando precisam de você e mostram em cima da cabeça o que estão fazendo ("rodando testes", "editando app.js").
- **Conversas com os agentes:** um chat para cada agente, com o relatório da tarefa fácil de ler, a pergunta dele
  em destaque e os botões **Conversar** (só responde) e **Executar** (mexe no projeto).
- **Especialistas de verdade:** front, back, mobile, DevOps, QA, segurança, banco, design e outros, cada um com
  manual, modelo e ferramentas próprios. O pedido vai sozinho para o especialista certo.
- **Painel lateral** (tecla **P**): números do dia e gráficos, quadro do trabalho (fila, fazendo, esperando você,
  feito), metas por projeto, ideias para depois, fichas dos projetos, linha do tempo e saúde do servidor.
- **Reunião:** chame 2 ou 3 especialistas para discutir um problema; eles conversam entre si e entregam uma decisão.
- **Publicação segura:** os agentes não conseguem publicar em produção sozinhos. Eles preparam o pedido e você aperta
  **Publicar**; o DevOps confere tudo antes. Mudanças de tela podem ganhar um link de prévia antes.
- **Histórico de publicações** (Coolify, pacotes dos apps, trocas de versão dos containers) com pedido de volta de versão.
- **Rotinas:** ronda diária da produção, vigia de containers e disco, resumo da manhã, memorando estratégico mensal.
- **Busca geral** (**Ctrl+K**): procura em tudo e manda pedidos, ex.: `devops ver o certificado do site`.

## Do que precisa

- **Linux com systemd** (um servidor, VPS ou PC com Linux). Em Mac ou Windows o escritório abre e mostra os agentes,
  mas mandar tarefas pelo escritório não funciona.
- **Node.js 20+**, `curl` e `jq`.
- **Claude Code** instalado e **logado com a sua assinatura** (Pro ou Max). O escritório usa a sua assinatura,
  nunca a API paga.
- Opcional: Docker (sala do datacenter), Coolify (histórico de publicações) e Tailscale (acesso pelo celular com HTTPS).

## Instalação

```bash
git clone https://github.com/Rodrigossff91/escritorio-de-agentes.git
cd escritorio-de-agentes
./instalar.sh
```

O instalador pergunta o nome da empresa e a pasta dos seus projetos, cria o `config.json`, a sua senha de acesso,
liga o escritório ao Claude Code (com backup do `settings.json`) e, se você rodar como root, instala o serviço.
Depois é só abrir `http://127.0.0.1:4800`. O passo a passo completo, com prints, está no [guia de uso](COMO-USAR.md).

Edite `especialistas/_empresa.md` para contar aos agentes o que a sua empresa faz e quais são os projetos.
Quanto melhor descrito, melhor eles trabalham.

## Acesso de fora (celular)

O escritório só escuta em `127.0.0.1`, de propósito. Para abrir de outro aparelho com segurança, use o
[Tailscale](https://tailscale.com):

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:4800
```

e coloque o endereço (ex.: `minha-maquina.seu-tailnet.ts.net:8443`) em `origensPermitidas` no `config.json`.

## Como funciona

1. Os ganchos do Claude Code (`hooks/enviar-evento.sh`) avisam o escritório a cada passo de cada sessão.
2. `server.mjs` (Node puro, sem dependências) guarda o estado e envia ao navegador ao vivo (SSE).
3. `public/` desenha o escritório com Three.js e mostra o chat e o painel.
4. Tarefas mandadas pelo escritório rodam como `claude -p` dentro de um serviço temporário do systemd,
   com o especialista certo (`--agents`) e permissões automáticas, e voltam como relatório.

## Segurança

- Login com senha (scrypt), cookie `HttpOnly`/`SameSite=Strict` e proteção contra requisições de outros sites.
- Um gancho síncrono (`hooks/guarda-deploy.sh`) bloqueia comandos de publicação nas tarefas do escritório,
  a não ser que você tenha apertado **Publicar**.
- Textos com cara de senha ou token são escondidos antes de aparecer na tela.
- Tudo o que é seu (conversas, login, tokens) fica em `data/`, que não vai para o git.

## Configuração

O `config.json` (criado pelo instalador a partir do `config.exemplo.json`) define:

| Chave | Para quê |
| --- | --- |
| `empresa`, `setores` | nome da empresa e as salas (cada projeto com as suas pastas) |
| `raizProjetos` | pasta principal dos projetos |
| `contas` | contas do Claude Code (`{"pessoal": ""}` usa a pasta padrão `~/.claude`) |
| `rotinas` | horários da ronda, do resumo da manhã, do vigia e das outras rotinas |
| `servidores` | como agrupar os containers do Docker na sala do datacenter |
| `clima` | latitude e longitude para chover no escritório quando chove na sua cidade |
| `origensPermitidas` | endereços de onde o escritório pode ser aberto (ex.: o do Tailscale) |

## Créditos

- [Three.js](https://threejs.org) (licença MIT).
- Robô "RobotExpressive" de Tomás Laulhé, com alterações de Don McCurdy (domínio público, CC0).

## Licença

MIT. Veja [LICENSE](LICENSE).
