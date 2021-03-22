import { Type } from '@nestjs/common'

import { IEventHandler } from '../events/eventHandler.interface'
import { IQueueHandler } from './queueHandler.interface'

export interface QueueOptions {
    events?: Array<Array<Type<IEventHandler>>>
    queues?: Array<Array<Type<IQueueHandler>>>
    sagas?: Array<Array<Type<any>>>
}
