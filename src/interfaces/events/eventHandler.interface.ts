import { Observable } from 'rxjs'

import { IEvent } from './event.interface'

export interface EventHandler<T extends IEvent = any> {
    handle(event: T): any | Observable<any> | Promise<any>
}
