import { EventBusBase } from '../eventBusBase'
import { IEvent } from '../interfaces'
import { EffectDecorator } from '../types/effectDecorator.type'
import { EFFECT_METADATA } from './constants'

export const Effect = (bus: typeof EventBusBase): EffectDecorator => (
    ...events: IEvent[]
): PropertyDecorator => {
    return (target: Record<string, unknown>, propertyKey: string | symbol): void => {
        const properties = Reflect.getMetadata(EFFECT_METADATA, target.constructor)?.data || []

        Reflect.defineMetadata(
            EFFECT_METADATA,
            {
                data: [...properties, { key: propertyKey, name: target.constructor.name, events }],
                bus,
            },
            target.constructor,
        )
    }
}
