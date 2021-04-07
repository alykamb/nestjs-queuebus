import { Observable } from 'rxjs'

import { IEvent } from './event.interface'

export interface IEventHandler<T extends IEvent = any> {
    handle(event: T): any | Observable<any> | Promise<any>
}
