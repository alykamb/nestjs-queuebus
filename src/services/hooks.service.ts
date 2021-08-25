import { Inject, Injectable, Scope } from '@nestjs/common'
import { Observable } from 'rxjs'

import { QUEUE_CONFIG_SERVICE } from '../constants'
import { IQueueConfigService } from '../interfaces'
import { Hook, HookContext } from '../types/hooks.type'

@Injectable({ scope: Scope.TRANSIENT })
export class HooksService<T> {
    protected hooks: T
    constructor(
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
    ) {}

    public getHooks(options: Record<keyof T, symbol>, instance: any): T {
        const sort = (
            p1: { key: string; order: number },
            p2: { key: string; order: number },
        ): number => p1.order - p2.order

        if (!this.hooks) {
            const constructor = Reflect.getPrototypeOf(instance).constructor
            const map = (property: { key: string; order: number }): any =>
                this.queueConfig[property.key]

            const getHooks = (event: symbol): Hook[] =>
                (Reflect.getMetadata(event, constructor) || []).sort(sort).map(map)

            this.hooks = Object.entries(options).reduce((acc, [k, s]: [string, symbol]) => {
                acc[k] = getHooks(s)
                return acc
            }, {} as Partial<T>) as T
        }

        return this.hooks
    }

    public runHooks(
        hooks: Hook[],
        context: HookContext,
        cb?: (d: any) => Promise<any>,
    ): (data: any) => Promise<any> {
        return (data: any): Promise<any> =>
            hooks.reduce(async (value, func) => {
                context.data = await this.parseHook(value)
                return func(context, cb)
            }, data)
    }

    public parseHook(value: any | Promise<any> | Observable<any>): Promise<any> | any {
        if (value && typeof value.subscribe === 'function') {
            return value.toPromise()
        }
        if (value && value instanceof Promise) {
            return value
        }
        return Promise.resolve(value)
    }
}
