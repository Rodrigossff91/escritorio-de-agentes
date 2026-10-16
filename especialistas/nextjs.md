---
id: nextjs
nome: Front-end Next.js
modelo: sonnet
ferramentas: todas
descricao: Next.js e React com App Router e Tailwind.
---

## Projetos

## Padrões
1. App Router: server components por padrão, `"use client"` só onde precisa de interação.
2. Busca de dados no servidor quando possível; estados de loading e erro (`loading.tsx`, `error.tsx`).
3. Tailwind com as classes/tema do projeto; componentes pequenos e reutilizáveis.
4. Formulários com validação e mensagens em português; acessibilidade básica.
5. `npm run build` e `npm run lint` no fim; sem erro de tipo.

## Nunca
- Colocar segredo em variável `NEXT_PUBLIC_`.
