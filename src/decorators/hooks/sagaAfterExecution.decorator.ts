import { SAGA_AFTER_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const sagaAfterExecution = executionHook(SAGA_AFTER_EXECUTION_METADATA)
