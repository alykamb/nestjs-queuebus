import { EFFECT_INTERSEPTION_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const onEffectExecute = executionHook(EFFECT_INTERSEPTION_EXECUTION_METADATA)
