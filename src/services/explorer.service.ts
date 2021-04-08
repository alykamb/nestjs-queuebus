import { Injectable, Type } from '@nestjs/common'
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper'
import { Module } from '@nestjs/core/injector/module'
import { ModulesContainer } from '@nestjs/core/injector/modules-container'

import {
    EFFECT_METADATA,
    EVENTS_HANDLER_METADATA,
    QUEUE_HANDLER_METADATA,
} from '../decorators/constants'
import { EventBusBase } from '../eventBusBase'
import { IQueueHandler } from '../interfaces/queues/queueHandler.interface'
import { QueueOptions } from '../interfaces/queues/queueOptions.interface'
import { QueueBusBase } from '../queueBusBase'

@Injectable()
export class ExplorerService {
    constructor(private readonly modulesContainer: ModulesContainer) {}

    public explore(queuesBuses, eventsBuses?): QueueOptions {
        const modules = [...this.modulesContainer.values()]

        const queues = queuesBuses.map((queueBus) => {
            return this.flatMap<IQueueHandler>(modules, (instance) =>
                this.filterProvider(instance, QUEUE_HANDLER_METADATA, queueBus),
            )
        })

        const [events, effects] = eventsBuses.reduce(
            (acc, eventBus) => {
                acc[0].push(
                    this.flatMap<IQueueHandler>(modules, (instance) =>
                        this.filterProvider(instance, EVENTS_HANDLER_METADATA, eventBus),
                    ),
                )
                acc[1].push(
                    this.flatMap(modules, (instance) =>
                        this.filterProvider(instance, EFFECT_METADATA, eventBus),
                    ),
                )
                return acc
            },
            [[], []],
        )

        return { events, effects, queues }
    }

    public flatMap<T>(
        modules: Module[],
        callback: (instance: InstanceWrapper) => Type<any> | undefined,
    ): Array<Type<T>> {
        const items = modules
            .map((module) => [...module.providers.values()].map(callback))
            .reduce((a, b) => a.concat(b), [])
        return items.filter((element) => !!element) as Array<Type<T>>
    }

    public filterProvider(
        wrapper: InstanceWrapper,
        metadataKey: string | symbol,
        bus: QueueBusBase | EventBusBase,
    ): Type<any> | undefined {
        const { instance } = wrapper
        if (!instance) {
            return undefined
        }
        const metadata = this.extractMetadata(instance, metadataKey)

        return metadata && metadata.bus === Object.getPrototypeOf(bus).constructor
            ? (instance.constructor as Type<any>)
            : undefined
    }

    public extractMetadata(
        instance: Record<string, any>,
        metadataKey: string | symbol,
    ): { data: Type<any>; bus: QueueBusBase | EventBusBase } {
        if (!instance.constructor) {
            return undefined
        }
        return Reflect.getMetadata(metadataKey, instance.constructor)
    }
}
