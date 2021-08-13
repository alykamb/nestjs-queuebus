import { OnModuleDestroy } from '@nestjs/common'

import { Callback } from '../types/callback'
import { IPubEvent } from './events/jobEvent.interface'

export type EventCallback<EventBase extends IPubEvent = IPubEvent> = (
    e: EventBase,
) => any | Promise<any>

export interface ITransport extends OnModuleDestroy {
    addJob<TRet = any, TData = any>(
        projectName: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options?: any,
    ): void
    createWorker(projectName: string, callback: (data: any) => Promise<any>): Promise<void>

    publishEvent<EventBase extends IPubEvent = IPubEvent>(
        busName: string,
        event: EventBase,
    ): Promise<void>

    registerEffect<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        callback: EventCallback<EventBase>,
        parallel: boolean,
        ...events: Array<{ name: string; projectName: string; eventBusName: string }>
    ): void

    removeEffect(name: string): void

    registerEventListener<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        callback: EventCallback<EventBase>,
    ): void

    removeEventListener(name: string): void

    onModuleDestroy(): Promise<boolean>
}
