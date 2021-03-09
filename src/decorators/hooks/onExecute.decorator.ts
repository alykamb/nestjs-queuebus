import { JOB_INTERSECTION_EXECUTION_METADATA } from "../constants";
import { executionHook } from "./execution.decorator";

export const onExecute = executionHook(JOB_INTERSECTION_EXECUTION_METADATA)