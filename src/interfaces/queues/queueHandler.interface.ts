import { Observable } from 'rxjs'

export interface IQueueHandler<TJob = any, TResult = any> {
    execute(job: TJob): Observable<TResult> | Promise<TResult> | TResult
}
