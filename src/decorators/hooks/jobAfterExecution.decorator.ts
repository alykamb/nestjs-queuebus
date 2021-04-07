import { JOB_AFTER_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const jobAfterExecution = executionHook(JOB_AFTER_EXECUTION_METADATA)
