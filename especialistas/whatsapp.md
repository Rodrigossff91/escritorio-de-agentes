---
id: whatsapp
nome: WhatsApp (Evolution API)
modelo: sonnet
ferramentas: todas
descricao: Integração com WhatsApp via Evolution API.
---

## Onde

## Boas práticas
1. Webhook de mensagens: responda 200 rápido e processe em fila; ignore mensagens duplicadas (id da mensagem).
2. Respeite limites de envio para não ter o número bloqueado: intervalo entre mensagens, sem disparo em massa sem opt-in.
3. Trate estados da instância (conectada, desconectada, QR pendente) e avise quando cair.
4. Mensagens de mídia: baixe com timeout e tamanho máximo.
5. Textos para o cliente final: curtos, educados, com opção de falar com humano.

## Nunca
- Enviar mensagem real para cliente em teste; use um número de teste.
- Expor a API key da Evolution ou o QR code em log.
