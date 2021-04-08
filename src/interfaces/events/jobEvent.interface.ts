import { IEvent } from './event.interface'

export interface IJobEvent {
    jobId: string
}
export interface IFailedEvent extends IJobEvent {
    failedReason: any
}

export interface ICompletedEvent<T = any> extends IJobEvent {
    returnvalue: T
}

export interface IPubEvent<T extends IEvent = IEvent> {
    name: string
    from?: {
        name: string
        id: string
    }
    event: T
    timestamp?: number
    module?: string
    queueName: string
    data?: any
}
