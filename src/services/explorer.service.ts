import { Injectable, Type } from '@nestjs/common'
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper'
import { Module } from '@nestjs/core/injector/module'
import { ModulesContainer } from '@nestjs/core/injector/modules-container'

import { EFFECT_METADATA, QUEUE_HANDLER_METADATA } from '../decorators/constants'
import { EventBusBase } from '../eventBusBase'
import { IQueueHandler } from '../interfaces/queues/queueHandler.interface'
import { QueueOptions } from '../interfaces/queues/queueOptions.interface'
import { QueueBusBase } from '../queueBusBase'

@Injectable()
export class ExplorerService {
    constructor(private readonly modulesContainer: ModulesContainer) {}

    public explore(queuesBuses: QueueBusBase[], eventsBuses?: EventBusBase[]): QueueOptions {
        const modules = [...this.modulesContainer.values()]

        const queues = queuesBuses.map((queueBus) => {
            return this.flatMap<IQueueHandler, Type<IQueueHandler>>(modules, (instance) =>
                this.filterProvider(instance, QUEUE_HANDLER_METADATA, queueBus),
            )
        })

        const effects = eventsBuses.reduce((acc, eventBus) => {
            acc.push(
                this.flatMap(modules, (instance) =>
                    this.filterProvider(instance, EFFECT_METADATA, eventBus),
                ),
            )
            return acc
        }, [])

        return { effects, queues }
    }

    public getBuses(): { queuesBuses: QueueBusBase[]; eventsBuses?: EventBusBase[] } {
        const modules = [...this.modulesContainer.values()]

        const map = <T = any>(arg: Type<T>): T[] =>
            this.flatMap<T, T>(modules, (instance) => {
                return instance?.instance &&
                    typeof instance.instance === 'object' &&
                    instance.instance instanceof arg
                    ? (instance.instance as T)
                    : undefined
            })

        return {
            queuesBuses: map(QueueBusBase),
            eventsBuses: map(EventBusBase),
        }
    }

    public flatMap<T = any, Q = Type<T> | T | undefined>(
        modules: Module[],
        callback: (instance: InstanceWrapper) => Q,
    ): Q[] {
        const items = modules
            .map((module) => [...module.providers.values()].map(callback))
            .reduce((a, b) => a.concat(b), [])
        return items.filter((element) => !!element) as Q[]
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

        if (metadata instanceof Array) {
            return metadata.find((m) => m.bus === Object.getPrototypeOf(bus).constructor)
                ? (instance.constructor as Type<any>)
                : undefined
        }
        return metadata && metadata.bus === Object.getPrototypeOf(bus).constructor
            ? (instance.constructor as Type<any>)
            : undefined
    }

    public extractMetadata(
        instance: Record<string, any>,
        metadataKey: string | symbol,
    ):
        | { data: Type<any>; bus: QueueBusBase | EventBusBase }
        | Array<{ bus: QueueBusBase | EventBusBase; [key: string]: any }> {
        if (!instance.constructor) {
            return undefined
        }
        return Reflect.getMetadata(metadataKey, instance.constructor)
    }
}
