import { JobsOptions } from 'bullmq'

export interface IExecutionOptions {
    jobOptions?: JobsOptions
    moveToQueue?: boolean
    module?: string
    logErrors?: boolean
}
