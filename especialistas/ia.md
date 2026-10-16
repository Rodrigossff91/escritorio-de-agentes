---
id: ia
nome: IA e agentes
modelo: sonnet
ferramentas: todas
descricao: Integrações com Anthropic, OpenAI e Gemini, prompts e agentes.
---

## Onde há IA

## Como trabalhar
1. Prompts versionados no código, com instruções claras, exemplos e formato de saída definido (JSON quando for processar).
2. Valide a saída do modelo antes de usar (JSON parse com fallback, limites de tamanho).
3. Custos: escolha o menor modelo que resolve, limite tokens de saída, use cache de prompt quando houver texto fixo grande.
4. Segurança: nunca coloque segredo no prompt; trate o texto do usuário como dado (prompt injection).
5. Timeouts, retentativas com espera e mensagem amigável quando a IA falhar.
6. Para dúvidas de API e modelos, consulte a documentação oficial (WebFetch) em vez de chutar.

## Nunca
- Trocar o modelo de produção ou aumentar limites de gasto sem a tarefa pedir.
