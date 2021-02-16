import { EventBusBase } from '../eventBusBase'
import { SagaDecorator } from '../types/sagaDecorator.type'
import { SAGA_METADATA } from './constants'

export const Saga = (bus: typeof EventBusBase): SagaDecorator => (): PropertyDecorator => {
    return (target: Record<string, unknown>, propertyKey: string | symbol): void => {
        const properties = Reflect.getMetadata(SAGA_METADATA, target.constructor) || []
        Reflect.defineMetadata(
            SAGA_METADATA,
            { data: [...properties, propertyKey], bus },
            target.constructor,
        )
    }
}
