import { ResultType } from '../../constants'
import { CommandType } from '../../models/command'
import { IExecutionOptions } from '../executionOptions.interface'

export interface IQueueBus {
    execute<T extends CommandType = CommandType>(
        command: T,
        options?: IExecutionOptions,
    ): T[ResultType]
}
