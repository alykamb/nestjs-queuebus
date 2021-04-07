import { EVENT_ON_RECEIVE_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const eventOnReceive = executionHook(EVENT_ON_RECEIVE_METADATA)
