export const EVENT_PATTERN = { cmd: 'nestjs_queue_PUBLISHED_EVENT' }

export const EXTRA_SEPARATOR = '::extra::'

export const QUEUE_CONFIG_SERVICE = Symbol()
export const QUEUE_DEFAULT_NAME = Symbol()
export const MESSAGE_BROOKER = Symbol()

export const TIMEOUT = 20000

export enum JobEventType {
    completed = 'completed',
    failed = 'failed',
}

export enum Transport {
    rabbitMQ = 'rabbitMQ',
}

export const RESULT_TYPE = Symbol()
export type ResultType = typeof RESULT_TYPE
