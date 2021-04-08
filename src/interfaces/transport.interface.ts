import { OnModuleDestroy } from '@nestjs/common'

import { Callback } from '../types/callback'
import { IPubEvent } from './events/jobEvent.interface'

export type EventCallback<EventBase extends IPubEvent = IPubEvent> = (
    e: EventBase,
) => any | Promise<any>

export interface ITransport extends OnModuleDestroy {
    addJob<TRet = any, TData = any>(
        module: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options?: any,
    ): void
    createWorker(module: string, callback: (data: any) => Promise<any>): Promise<void>

    publishEvent<EventBase extends IPubEvent = IPubEvent>(event: EventBase): Promise<void>

    // onEvent<EventBase extends PubEvent = PubEvent>(
    //     queueBusName: string,
    //     callback: EventCallback<EventBase>,
    // ): void

    registerEffect<EventBase extends IPubEvent = IPubEvent>(
        queueBusName: string,
        name: string,
        callback: EventCallback<EventBase>,
        ...events: string[]
    ): void

    removeEffect(name: string): void

    registerEventListener<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        callback: EventCallback<EventBase>,
    ): void

    removeEventListener(name: string): void

    onModuleDestroy(): Promise<boolean>
}
