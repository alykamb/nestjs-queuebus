import { Hook } from '../types/hooks.type'

export interface IJobExecutionInterceptors {
    before: Hook[]
    after: Hook[]
    interceptor: Hook[]
}
