import { EventBusBase, QueueBusBase } from '..'
// import { Transport } from '../constants'

export interface IQueueConfigService {
    name: string
    id: string

    host?: string
    port: number
    username?: string
    password?: string

    getQueues: () => {
        queues: Array<typeof QueueBusBase>
        events: Array<typeof EventBusBase>
    }
}
