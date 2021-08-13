import { Observable } from 'rxjs'

import { EventBusBase } from '..'
import { QueueBusBase } from '../queueBusBase'

export type HookContext<T = any> = {
    data?: T
    name: string
    bus: QueueBusBase | EventBusBase
    projectName?: any
}
export type Hook<T = any> = (
    context: HookContext<T>,
    cb?: (d: any) => any | Observable<any> | Promise<any>,
) => any | Observable<any> | Promise<any>
