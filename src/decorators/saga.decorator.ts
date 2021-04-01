import { EventBusBase } from '../eventBusBase'
import { IEvent } from '../interfaces'
import { SagaDecorator } from '../types/sagaDecorator.type'
import { SAGA_METADATA } from './constants'

export const Saga = (bus: typeof EventBusBase): SagaDecorator => (
    ...events: IEvent[]
): PropertyDecorator => {
    return (target: Record<string, unknown>, propertyKey: string | symbol): void => {
        const properties = Reflect.getMetadata(SAGA_METADATA, target.constructor)?.data || []

        Reflect.defineMetadata(
            SAGA_METADATA,
            {
                data: [...properties, { key: propertyKey, name: target.constructor.name, events }],
                bus,
            },
            target.constructor,
        )
    }
}
