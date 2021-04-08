import { Observable } from 'rxjs'

import { IEvent } from './event.interface'

export type ISaga<EventBase extends IEvent = IEvent> = (
    event: EventBase,
) => Observable<any> | Promise<any> | any
