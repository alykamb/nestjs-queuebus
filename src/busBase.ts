import { Observable } from 'rxjs'

import { IQueueConfigService } from './interfaces'
import { Hook, HookContext } from './types/hooks.type'

export class BusBase<T> {
    protected hooks: T

    constructor(protected readonly queueConfig: IQueueConfigService) {}

    protected getHooks(options: Record<keyof T, symbol>): T {
        const sort = (
            p1: { key: string; order: number },
            p2: { key: string; order: number },
        ): number => p1.order - p2.order

        if (!this.hooks) {
            const constructor = Reflect.getPrototypeOf(this).constructor
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

    protected runHooks(
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

    protected parseHook(value: any | Promise<any> | Observable<any>): Promise<any> | any {
        if (value && typeof value.subscribe === 'function') {
            return value.toPromise()
        }
        if (value && value instanceof Promise) {
            return value
        }
        return Promise.resolve(value)
    }
}
