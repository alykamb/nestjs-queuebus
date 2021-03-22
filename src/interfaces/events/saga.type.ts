import { Observable } from 'rxjs'

import { IQueueJob } from '../..'
import { IQueue } from '../queues/queue.interface'
import { IEvent } from './event.interface'
import { PubEvent } from './jobEvent.interface'

export type ISaga<
    EventBase extends IEvent = IEvent,
    JobBase extends IQueue | IQueueJob<any> = IQueue
> = (events$: Observable<PubEvent<EventBase>>) => Observable<JobBase>
