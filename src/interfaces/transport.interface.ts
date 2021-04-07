import { OnModuleDestroy } from '@nestjs/common'

import { Callback } from '../types/callback'
import { PubEvent } from './events/jobEvent.interface'

export type EventCallback<EventBase extends PubEvent = PubEvent> = (e: EventBase) => void

export interface ITransport extends OnModuleDestroy {
    addJob<TRet = any, TData = any>(
        module: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options?: any,
    ): void
    createWorker(module: string, callback: (data: any) => Promise<any>): Promise<void>

    publishEvent<EventBase extends PubEvent = PubEvent>(event: EventBase): Promise<void>

    // onEvent<EventBase extends PubEvent = PubEvent>(
    //     queueBusName: string,
    //     callback: EventCallback<EventBase>,
    // ): void

    registerSaga<EventBase extends PubEvent = PubEvent>(
        queueBusName: string,
        name: string,
        callback: EventCallback<EventBase>,
        ...events: string[]
    ): void

    removeSaga(name: string): void

    registerEventListener<EventBase extends PubEvent = PubEvent>(
        name: string,
        callback: EventCallback<EventBase>,
    ): void

    removeEventListener(name: string): void

    onModuleDestroy(): Promise<boolean>
}
