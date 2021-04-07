import { IEvent } from '../interfaces'

export type SagaDecorator = (...events: IEvent[]) => PropertyDecorator
