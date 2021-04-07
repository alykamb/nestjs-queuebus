import { SAGA_BEFORE_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const sagaBeforeExecution = executionHook(SAGA_BEFORE_EXECUTION_METADATA)
