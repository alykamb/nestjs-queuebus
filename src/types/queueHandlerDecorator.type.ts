import { IQueue } from '../interfaces/queues/queue.interface'

export type QueueHandlerDecorator = (queueImpl: IQueue) => ClassDecorator
