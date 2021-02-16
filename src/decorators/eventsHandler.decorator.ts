import { EVENTS_HANDLER_METADATA } from './constants'
import { EventBusBase, IEvent } from '../index'

export const EventsHandler = (bus: typeof EventBusBase) => (
    ...events: IEvent[]
): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(EVENTS_HANDLER_METADATA, { data: events, bus }, target)
    }
}
