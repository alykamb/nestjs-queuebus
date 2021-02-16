import { IEvent } from '../interfaces'

export type EventHandlerDecorator = (...events: IEvent[]) => ClassDecorator
