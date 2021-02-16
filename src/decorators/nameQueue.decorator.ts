import { NAME_QUEUE_METADATA } from './constants'

export const NameQueue = (name: string): ClassDecorator => (target: any): void => {
    Reflect.defineMetadata(NAME_QUEUE_METADATA, name, target)
}
