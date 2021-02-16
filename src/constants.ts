export const EVENT_PATTERN = { cmd: 'nestjs_queue_PUBLISHED_EVENT' }

export const EXTRA_SEPARATOR = '::extra::'

export const QUEUE_CONFIG_SERVICE = Symbol()

export enum JobEventType {
    completed = 'completed',
    failed = 'failed',
}
