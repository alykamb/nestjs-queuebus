import { QueueHandler } from './queueHandler.decorator'
import { EventsHandler } from './eventsHandler.decorator'
import { EventBusBase } from '../eventBusBase'
import { QueueBusBase } from '../queueBusBase'
import { Saga } from './saga.decorator'
import { QueueHandlerDecorator } from '../types/queueHandlerDecorator.type'
import { EventHandlerDecorator } from '../types/eventHandlerDecorator.type'
import { SagaDecorator } from '../types/sagaDecorator.type'

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
 * Cria um decorador de Saga para um EventBus
 * @param eventBus - EventBus para qual o decorador será criado
 * @returns um decorador de Saga
 */
export function createEventSagaDecorator(eventBus: typeof EventBusBase): SagaDecorator {
    return Saga(eventBus)
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
    events: Array<[EventHandlerDecorator, SagaDecorator]>
} {
    return {
        queues: !buses.queues ? [] : buses.queues.map(createQueueBusDecorator),
        events: !buses.events
            ? []
            : buses.events.map((eventBus) => [
                  createEventBusDecorator(eventBus),
                  createEventSagaDecorator(eventBus),
              ]),
    }
}
