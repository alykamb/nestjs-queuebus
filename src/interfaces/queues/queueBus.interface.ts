import { Observable } from 'rxjs'
import { IExecutionOptions } from '../executionOptions.interface'

export interface IQueueBus<ImplBase extends any> {
    execute<T = any, Q extends ImplBase = ImplBase>(
        job: Q,
        options: IExecutionOptions,
    ): Observable<T>
}
