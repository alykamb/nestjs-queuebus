import { OnModuleDestroy } from '@nestjs/common'

import { Callback } from '../types/callback'

export interface ITransport extends OnModuleDestroy {
    addJob<TRet = any, TData = any>(
        module: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options?: any,
    ): void

    createWorker(module: string, callback: (data: any) => Promise<any>): Promise<void>

    onModuleDestroy(): Promise<boolean>
}
