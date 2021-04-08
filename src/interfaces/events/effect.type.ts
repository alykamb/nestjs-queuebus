import { Observable } from 'rxjs'

import { IEvent } from './event.interface'

export type IEffect<EventBase extends IEvent = IEvent> = (
    event: EventBase,
) => Observable<any> | Promise<any> | any
