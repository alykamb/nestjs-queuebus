import { ResultType } from '../../constants'
import { CommandType } from '../../models/command'

export interface IQueueHandler<T extends CommandType = CommandType> {
    execute(job: T): T[ResultType]
}
