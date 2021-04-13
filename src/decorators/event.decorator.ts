import { EVENTS_METADATA } from './constants'

export const Event = (module?: string): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(EVENTS_METADATA, module, target)
    }
}
