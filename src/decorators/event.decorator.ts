import { EVENTS_METADATA } from './constants'

export const Event = (projectName?: string): ClassDecorator => {
    return (target: any): void => {
        Reflect.defineMetadata(EVENTS_METADATA, projectName, target)
    }
}
