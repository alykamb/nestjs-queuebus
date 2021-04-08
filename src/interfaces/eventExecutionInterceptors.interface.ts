import { Hook } from '../types/hooks.type'

export interface IEventExecutionInterceptors {
    eventBeforeExecution: Hook[]
    eventAfterExecution: Hook[]
    eventOnReceive: Hook[]
    eventBeforePublish: Hook[]
    eventAfterPublish: Hook[]
    effectBeforeExecution: Hook[]
    effectAfterExecution: Hook[]
}
