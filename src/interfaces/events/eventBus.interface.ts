import { IEvent } from './event.interface'

export interface IEventBus<EventBase extends IEvent = IEvent> {
    publish<T extends EventBase = EventBase>(event: T): void
}
