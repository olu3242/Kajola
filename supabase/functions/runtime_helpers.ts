export type RuntimeFailureClass =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'BUSINESS_REJECTION'
  | 'POLICY_VIOLATION'
  | 'TIMEOUT'
  | 'DEPENDENCY_FAILURE'
  | 'INTEGRATION_FAILURE'
  | 'UNKNOWN';

export type RuntimeRetryDecision = {
  retry: boolean;
  nextStatus: 'pending' | 'failed';
  retryCount: number;
  delaySeconds: number;
};

/** Runtime OS owns delivery/backoff. Workflow and automation callers only
 * provide failure meaning and a named policy. */
export function runtimeRetryDecision(input: {
  currentRetryCount: number;
  failureClass: RuntimeFailureClass;
  policy?: 'FAST_INTERNAL_TASK' | 'STANDARD_NETWORK_CALL' | 'PAYMENT_PROVIDER' | 'WEBHOOK_PROCESSING';
}): RuntimeRetryDecision {
  const maxAttempts = input.policy === 'FAST_INTERNAL_TASK' ? 2 : 3;
  const retryCount = input.currentRetryCount + 1;
  const retryable = ['TRANSIENT', 'TIMEOUT', 'DEPENDENCY_FAILURE', 'INTEGRATION_FAILURE', 'UNKNOWN'].includes(input.failureClass);
  const retry = retryable && retryCount < maxAttempts;
  return {
    retry,
    nextStatus: retry ? 'pending' : 'failed',
    retryCount,
    delaySeconds: retry ? Math.min(300, 2 ** retryCount * 30) : 0,
  };
}
