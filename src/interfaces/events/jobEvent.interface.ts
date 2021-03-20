import { IEvent } from './event.interface'

export interface JobEvent {
    jobId: string
}
export interface FailedEvent extends JobEvent {
    failedReason: any
}

export interface CompletedEvent<T = any> extends JobEvent {
    returnvalue: T
}

export interface PubEvent<T extends IEvent = IEvent> {
    name: string
    event: T
    timestamp?: number
    module?: string
}
