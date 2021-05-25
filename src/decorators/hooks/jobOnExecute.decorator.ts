import { JOB_INTERSEPTION_EXECUTION_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const onExecute = executionHook(JOB_INTERSEPTION_EXECUTION_METADATA)
