import { EVENT_BEFORE_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const eventBeforeExecution = executionHook(EVENT_BEFORE_EXECUTION_METADATA)
