import { Type } from '@nestjs/common'

import { EventHandler } from '../events/eventHandler.interface'
import { IQueueHandler } from './queueHandler.interface'

export interface QueueOptions {
    events?: Array<Array<Type<EventHandler>>>
    queues?: Array<Array<Type<IQueueHandler>>>
    effects?: Array<Array<Type<any>>>
}
