import { EVENT_AFTER_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const eventAfterExecution = executionHook(EVENT_AFTER_EXECUTION_METADATA)
