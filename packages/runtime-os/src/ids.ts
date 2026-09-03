import { randomUUID } from 'crypto';

const short = () => randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();

export const newOperationId    = () => `opr_${short()}`;
export const newCorrelationId  = () => `cor_${short()}`;
export const newTraceId        = () => `trc_${short()}`;
export const newAuditId        = () => `aud_${short()}`;
export const newPolicyId       = () => `pdc_${short()}`;
export const newEventId        = () => `evt_${short()}`;
export const newApprovalId     = () => `apr_${short()}`;
export const newWorkflowRunId  = () => `wfr_${short()}`;
export const newStepRunId      = () => `wfs_${short()}`;
export const newAgentRunId     = () => `agr_${short()}`;
export const newToolCallId     = () => `tlc_${short()}`;
export const newDeadLetterId   = () => `dlq_${short()}`;
