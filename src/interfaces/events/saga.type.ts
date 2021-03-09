import { IEvent } from './event.interface'
import { Observable } from 'rxjs'
import { PubEvent } from './jobEvent.interface'
import { IQueue } from '../queues/queue.interface'
import { IQueueJob } from '../..'

export type ISaga<EventBase extends IEvent = IEvent, JobBase extends IQueue | IQueueJob<any> = IQueue> = (
    events$: Observable<PubEvent<EventBase>>,
) => Observable<JobBase>
