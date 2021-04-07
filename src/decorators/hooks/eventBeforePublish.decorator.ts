import { EVENT_BEFORE_PUBLISH_METADATA } from '../constants'
import { executionHook } from './execution.decorator'

export const eventBeforePublish = executionHook(EVENT_BEFORE_PUBLISH_METADATA)
