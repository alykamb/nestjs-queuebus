import { EFFECT_ON_RECEIVE_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const eventOnReceive = executionHook(EFFECT_ON_RECEIVE_METADATA)
