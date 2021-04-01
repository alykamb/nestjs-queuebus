import { IEvent, IQueue } from '../interfaces'

export type SagaData = {
    key: string
    commands: IQueue[]
    name: string
    events: IEvent[]
}
