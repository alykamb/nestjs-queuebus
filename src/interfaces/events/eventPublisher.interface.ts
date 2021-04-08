import { IPubEvent } from './jobEvent.interface'

export interface IEventPublisher<EventBase extends IPubEvent = IPubEvent> {
    publish<T extends EventBase = EventBase>(event: T): any
}
