import { IEvent } from '../interfaces'

export type EffectDecorator = (...events: IEvent[]) => PropertyDecorator
