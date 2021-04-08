import { EFFECT_BEFORE_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const effectBeforeExecution = executionHook(EFFECT_BEFORE_EXECUTION_METADATA)
