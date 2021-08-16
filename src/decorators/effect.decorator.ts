import { EventBusBase } from '../eventBusBase'
import { IEvent } from '../interfaces'
import { EffectDecorator } from '../types/effectDecorator.type'
import { EFFECT_METADATA } from './constants'

const effectDecorator =
    (bus: typeof EventBusBase, parallel: boolean): EffectDecorator =>
    (...events: IEvent[]): PropertyDecorator => {
        return (target: Record<string, unknown>, propertyKey: string | symbol): void => {
            const properties = Reflect.getMetadata(EFFECT_METADATA, target.constructor) || []

            Reflect.defineMetadata(
                EFFECT_METADATA,
                [
                    ...properties,
                    { key: propertyKey, name: target.constructor.name, events, parallel, bus },
                ],
                target.constructor,
            )
        }
    }

type EffectType = (bus: typeof EventBusBase) => EffectDecorator

export const Effect: EffectType = (bus) => effectDecorator(bus, false)
export const ParallelEffect: EffectType = (bus) => effectDecorator(bus, true)
