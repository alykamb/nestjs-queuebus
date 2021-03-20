import { QueueBusBase } from "../../queueBusBase";

export const executionHook = (hook: symbol) => (bus: typeof QueueBusBase, order = 0): PropertyDecorator => (target, key) => {
    const properties = Reflect.getMetadata(hook, target.constructor) || []
    Reflect.defineMetadata(
        hook, 
        [...properties, {key, order}],
        bus
    )
}