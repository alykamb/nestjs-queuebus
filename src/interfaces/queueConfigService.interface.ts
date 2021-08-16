import { Transport } from '../constants'

export interface IQueueConfigService {
    name: string
    id: string

    host?: string
    port: number
    username?: string
    password?: string

    verbose?: boolean
    logger?: (message: string, error?: boolean) => void

    environment?: string

    messageBrooker: Transport
}
