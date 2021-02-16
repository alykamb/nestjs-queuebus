import { IQueue } from '../interfaces/queues/queue.interface'
import { QueueBusBase } from '../queueBusBase'
import { QueueHandlerDecorator } from '../types/queueHandlerDecorator.type'
import { QUEUE_HANDLER_METADATA } from './constants'

export const QueueHandler = (bus: typeof QueueBusBase): QueueHandlerDecorator => (
    queueImpl: IQueue,
): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(QUEUE_HANDLER_METADATA, { data: queueImpl, bus }, target)
    }
}
