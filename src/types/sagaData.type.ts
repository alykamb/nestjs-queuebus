import { IEvent } from '../interfaces'

export type SagaData = {
    key: string
    name: string
    events: IEvent[]
}
