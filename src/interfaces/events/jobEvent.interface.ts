import { IEvent } from './event.interface'
import { JobEventType } from '../../constants'

export interface JobEvent {
    jobId: string
    event: JobEventType
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
