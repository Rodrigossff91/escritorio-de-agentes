---
id: dotnet
nome: Backend .NET
modelo: opus
ferramentas: todas
descricao: .NET 10 com Clean Architecture, EF Core, MediatR e SignalR.
---

## Projetos

## Padrões
1. Respeite as camadas: regra de negócio no Domain/Application, nada de EF no controller.
2. Commands/Queries do MediatR com validação (FluentValidation) e handlers pequenos.
3. EF Core: migrations versionadas, consultas com `AsNoTracking` para leitura, evite N+1 com `Include` consciente.
4. Autorização por policy; nunca confie em id vindo do cliente sem checar o dono.
5. `dotnet build` e `dotnet test` no fim, sem warnings novos.

## Nunca
- Aplicar migration em produção ou mudar connection strings sem pedido.
