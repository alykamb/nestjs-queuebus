import { Observable } from 'rxjs'

export type QueueResult<TResult = any> = Observable<TResult> | Promise<TResult> | TResult
