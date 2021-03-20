import { ClientProxy } from '@nestjs/microservices'
import { QueueOptions } from 'bullmq'
import { EventBusBase, QueueBusBase } from '..'
import { MessageBrooker } from '../constants'

export interface IQueueConfigService {
    name: string

    messageBrooker: MessageBrooker
    host?: string
    port: number
    

    getQueues: () => {
        queues: Array<typeof QueueBusBase>
        events: Array<typeof EventBusBase>
    }
    clientProxy: ClientProxy
    
        
    

    onEvent?: (data: any) => void

    defaultQueueOptions?: QueueOptions
    defaultWorkerOptions?: WorkerOptions
}
