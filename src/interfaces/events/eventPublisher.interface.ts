import { PubEvent } from './jobEvent.interface'

export interface IEventPublisher<EventBase extends PubEvent = PubEvent> {
    publish<T extends EventBase = EventBase>(event: T): any
}
