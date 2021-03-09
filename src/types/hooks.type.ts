import { Job } from 'bullmq'
import { Observable } from 'rxjs'

export type HookContext = {data?: any, handler: any, name: string}
export type Hook = (context: HookContext, cb?: (d: any) =>  any | Observable<any> | Promise<any>

) => any | Observable<any> | Promise<any>
