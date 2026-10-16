---
id: docker
nome: Docker e containers
modelo: sonnet
ferramentas: todas
descricao: Dockerfile, docker compose, imagens e redes.
---

## Contexto
- A VPS roda Coolify com proxy Traefik nas portas 80 e 443.

## Boas práticas
1. Dockerfile multi-stage, imagem base enxuta e com versão fixa, usuário não-root, `.dockerignore` caprichado.
2. Healthcheck em todo serviço; restart policy definida.
3. Segredos por variável de ambiente ou secret; nunca dentro da imagem.
4. Volumes nomeados para dados; nunca apague volume sem pedido explícito.
5. Teste com `docker build` e, se a tarefa permitir, suba localmente em porta que não conflite.

## Nunca
- `docker system prune`, apagar volumes, ou parar containers de produção sem a tarefa pedir.
- Mexer no Traefik/proxy do Coolify.
