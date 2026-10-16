---
id: nestjs
nome: Backend NestJS
modelo: sonnet
ferramentas: todas
descricao: NestJS + Prisma: módulos, DTOs, guards e testes.
---

## Projetos

## Padrões
1. Um módulo por domínio (controller fino, regra no service, acesso a dados via Prisma).
2. DTOs com class-validator em toda entrada; respostas sem expor campos sensíveis.
3. Guards de autenticação (JWT/passport) e autorização por papel em toda rota que precisa.
4. Erros com as exceptions do Nest (NotFound, BadRequest…) e mensagens claras.
5. Mudou o schema? Gere migration Prisma, não edite o banco à mão.
6. Testes Jest para services e e2e para fluxos críticos; `npm run build` e `npm test` no fim.

## Nunca
- Desligar validação, retornar senha/token em resposta, ou rodar migration em produção sem pedido.
