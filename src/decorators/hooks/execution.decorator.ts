import { QueueBusBase } from "../../queueBusBase";

export const executionHook = (hook: symbol) => (bus: typeof QueueBusBase): PropertyDecorator => (target, propertyKey) => {
    const properties = Reflect.getMetadata(hook, target.constructor) || []
    Reflect.defineMetadata(
        hook, 
        [...properties, propertyKey],
        bus
    )
}