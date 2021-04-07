import { EVENT_AFTER_PUBLISH_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const eventAfterPublish = executionHook(EVENT_AFTER_PUBLISH_METADATA)
