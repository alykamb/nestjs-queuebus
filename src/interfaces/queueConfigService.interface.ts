import { ClientProxy } from '@nestjs/microservices'
import { QueueOptions } from 'bullmq'
import { EventBusBase, QueueBusBase } from '..'

export interface IQueueConfigService {
    name: string
    getQueues: () => {
        queues: Array<typeof QueueBusBase>
        events: Array<typeof EventBusBase>
    }
    clientProxy: ClientProxy
    redisConfig?: {
        host: string
        port: number
    }

    onEvent?: (data: any) => void

    defaultQueueOptions?: QueueOptions
    defaultWorkerOptions?: WorkerOptions
}
