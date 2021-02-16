import { EVENTS_METADATA as EVENT_METADATA } from './constants'

export const Event = (module?: string): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(EVENT_METADATA, module, target)
    }
}
