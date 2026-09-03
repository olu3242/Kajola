export * from './workflow-runner';
export * from './workflow-definitions';

import { WorkflowRunner, InMemoryWorkflowRepository } from './workflow-runner';
import { ALL_WORKFLOWS } from './workflow-definitions';
import type { OperationExecutor } from '@kajola/runtime-os';

export function createInMemoryWorkflowOS(executor: OperationExecutor) {
  const repo   = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner(repo, executor);
  for (const wf of ALL_WORKFLOWS) { runner.register(wf); }
  return { runner, repo };
}
