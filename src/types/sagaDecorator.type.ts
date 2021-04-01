import { IEvent, IQueue } from '../interfaces'

export type SagaDecorator = (arg: { events: IEvent[]; commands: IQueue[] }) => PropertyDecorator
