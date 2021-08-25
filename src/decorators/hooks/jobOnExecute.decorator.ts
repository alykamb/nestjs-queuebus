import { JOB_EXECUTION_INTERSEPTOR_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const onExecute = executionHook(JOB_EXECUTION_INTERSEPTOR_METADATA)
