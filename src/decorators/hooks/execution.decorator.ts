import { EventBusBase } from '../..'
import { QueueBusBase } from '../../queueBusBase'

export const executionHook = (hook: symbol) => (
    bus: typeof QueueBusBase | typeof EventBusBase,
    order = 0,
): PropertyDecorator => (target, key): void => {
    const properties = Reflect.getMetadata(hook, target.constructor) || []
    Reflect.defineMetadata(hook, [...properties, { key, order }], bus)
}
