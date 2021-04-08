import { EFFECT_AFTER_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const effectAfterExecution = executionHook(EFFECT_AFTER_EXECUTION_METADATA)
