import { EventBusBase } from '../eventBusBase'
import { QueueBusBase } from '../queueBusBase'
import { EffectDecorator } from '../types/effectDecorator.type'
import { EventHandlerDecorator } from '../types/eventHandlerDecorator.type'
import { QueueHandlerDecorator } from '../types/queueHandlerDecorator.type'
import { Effect } from './effect.decorator'
import { EventsHandler } from './eventsHandler.decorator'
import { QueueHandler } from './queueHandler.decorator'

/**
 * Cria um decorador de Handler para um QueueBus
 * @param queueBus - QueueBus para qual o decorador será criado
 * @returns um decorador de QueueHandler
 */
export function createQueueBusDecorator(queueBus: typeof QueueBusBase): QueueHandlerDecorator {
    return QueueHandler(queueBus)
}

/**
 * Cria um decorador de Handler para um EventBus
 * @param eventBus - EventBus para qual o decorador será criado
 * @returns um decorador de EventHandler
 */
export function createEventBusDecorator(eventBus: typeof EventBusBase): EventHandlerDecorator {
    return EventsHandler(eventBus)
}

/**
 * Cria um decorador de Effect para um EventBus
 * @param eventBus - EventBus para qual o decorador será criado
 * @returns um decorador de Effect
 */
export function createEventEffectDecorator(eventBus: typeof EventBusBase): EffectDecorator {
    return Effect(eventBus)
}

/**
 * Cria os decoradores pra listas de Queue Buses e Event Buses
 * @param buses objeto com listas de Queue Buses e Event Buses
 * @returns
 */
export function createDecorators(buses: {
    queues?: Array<typeof QueueBusBase>
    events?: Array<typeof EventBusBase>
}): {
    queues: QueueHandlerDecorator[]
    events: Array<[EventHandlerDecorator, EffectDecorator]>
} {
    return {
        queues: !buses.queues ? [] : buses.queues.map(createQueueBusDecorator),
        events: !buses.events
            ? []
            : buses.events.map((eventBus) => [
                  createEventBusDecorator(eventBus),
                  createEventEffectDecorator(eventBus),
              ]),
    }
}
