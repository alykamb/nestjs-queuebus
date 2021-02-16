import { IExecutionOptions } from '../executionOptions.interface'
import { IQueue } from './queue.interface'

export interface IQueueJob<T = IQueue> {
    job: T
    options: IExecutionOptions
}
