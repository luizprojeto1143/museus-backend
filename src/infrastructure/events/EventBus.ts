import { EventEmitter } from 'events';

class EventBus extends EventEmitter {
  constructor() {
    super();
    // Aumentar o limite se tivermos muitos listeners (padrão é 10)
    this.setMaxListeners(20);
  }

  /**
   * Dispara um evento para o sistema inteiro (Background)
   */
  public publish(eventName: string, payload: any) {
    console.log(`[EventBus] Publishing: ${eventName}`, payload);
    this.emit(eventName, payload);
  }

  /**
   * Assina um evento para processamento em background
   */
  public subscribe(eventName: string, handler: (payload: any) => void) {
    console.log(`[EventBus] Subscribed to: ${eventName}`);
    this.on(eventName, async (payload) => {
      try {
        await handler(payload);
      } catch (error) {
        console.error(`[EventBus] Error handling event ${eventName}:`, error);
        // Aqui poderíamos ter uma Dead Letter Queue ou Retry lógico futuramente
      }
    });
  }
}

export const eventBus = new EventBus();

// ==========================================
// REGISTRO DE EVENTOS (Orquestração Inicial)
// ==========================================

import { prisma } from '../../prisma.js';

// Exemplo: Quando uma reserva é criada, geramos gamificação de forma assíncrona
eventBus.subscribe('BookingCreated', async (payload: { visitorId: string, providerId: string }) => {
  console.log('[Event Worker] Processing BookingCreated...', payload);
  
  // Lógica assíncrona que antes travaria a request
  const visitor = await prisma.visitor.findUnique({ where: { id: payload.visitorId }});
  if (visitor) {
    // Dá 50 CulturaCoins por cada compra no Marketplace
    await prisma.visitor.update({
      where: { id: payload.visitorId },
      data: { xp: { increment: 50 } }
    });
    console.log(`[Event Worker] Awared 50 XP to visitor ${payload.visitorId}`);
  }
});

eventBus.subscribe('ProviderReviewed', async (payload: { reviewId: string }) => {
  console.log('[Event Worker] Processing ProviderReviewed...', payload);
  // Pode notificar o painel master de moderação via WebSocket futuramente
});
