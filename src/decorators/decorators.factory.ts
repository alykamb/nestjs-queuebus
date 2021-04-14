import { EventBusBase } from '../eventBusBase'
import { QueueBusBase } from '../queueBusBase'
import { EffectDecorator } from '../types/effectDecorator.type'
import { QueueHandlerDecorator } from '../types/queueHandlerDecorator.type'
import { Effect } from './effect.decorator'
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
    events: EffectDecorator[]
} {
    return {
        queues: !buses.queues ? [] : buses.queues.map(createQueueBusDecorator),
        events: !buses.events
            ? []
            : buses.events.map((eventBus) => createEventEffectDecorator(eventBus)),
    }
}
