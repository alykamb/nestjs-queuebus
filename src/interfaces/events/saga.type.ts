import { Observable } from 'rxjs'

import { IEvent } from './event.interface'
import { PubEvent } from './jobEvent.interface'

export type ISaga<EventBase extends IEvent = IEvent> = (
    events: PubEvent<EventBase>,
) => Observable<any> | Promise<any> | any
