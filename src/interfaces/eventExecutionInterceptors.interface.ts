import { Hook } from '../types/hooks.type'

export interface IEventExecutionInterceptors {
    eventOnReceive: Hook[]
    eventBeforePublish: Hook[]
    eventAfterPublish: Hook[]
    effectBeforeExecution: Hook[]
    effectAfterExecution: Hook[]
}
