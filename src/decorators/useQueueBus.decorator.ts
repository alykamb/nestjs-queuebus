import { QueueBusBase } from '..'
import { EVENTBUS_QUEUEBUS_METADATA } from './constants'

export const UseQueueBus = (bus: typeof QueueBusBase): ClassDecorator => (target): void => {
    Reflect.defineMetadata(EVENTBUS_QUEUEBUS_METADATA, bus, target)
}
