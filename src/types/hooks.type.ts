import { Job } from 'bullmq'
import { Observable } from 'rxjs'
import { QueueBusBase } from '../queueBusBase'

export type HookContext = {data?: any, name: string, bus: QueueBusBase,  module?: any}
export type Hook = (context: HookContext, cb?: (d: any) =>  any | Observable<any> | Promise<any>

) => any | Observable<any> | Promise<any>
