import { JOB_BEFORE_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const jobBeforeExecution = executionHook(JOB_BEFORE_EXECUTION_METADATA)
