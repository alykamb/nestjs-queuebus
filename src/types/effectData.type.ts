import { EventBusBase } from '../eventBusBase'
import { IEvent } from '../interfaces'

export type EffectData = {
    key: string
    events: IEvent[]
    name: string
    parallel: boolean
    bus: EventBusBase
}
