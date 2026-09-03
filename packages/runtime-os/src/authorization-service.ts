import type { OperationContext, RiskLevel } from '@kajola/contracts';

export type CommandPermission = {
  command:     string;
  riskLevel:   RiskLevel;
  allowedRoles: string[];
  allowedActorTypes: Array<'human' | 'agent' | 'workflow' | 'system' | 'webhook'>;
};

const DEFAULT_PERMISSIONS: CommandPermission[] = [
  // Public discovery
  { command: 'SearchProviders',    riskLevel: 'R0', allowedRoles: ['*'],     allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  { command: 'ReadAvailability',   riskLevel: 'R0', allowedRoles: ['*'],     allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  // Client operations
  { command: 'HoldBookingSlot',    riskLevel: 'R1', allowedRoles: ['client', 'owner'], allowedActorTypes: ['human', 'agent', 'workflow'] },
  { command: 'CreatePaymentIntent',riskLevel: 'R2', allowedRoles: ['client', 'owner'], allowedActorTypes: ['human', 'workflow'] },
  { command: 'ConfirmBooking',     riskLevel: 'R2', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system', 'webhook'] },
  { command: 'CancelBooking',      riskLevel: 'R2', allowedRoles: ['client', 'owner', 'artisan', 'system'], allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  { command: 'CreateRebooking',    riskLevel: 'R1', allowedRoles: ['client', 'owner'], allowedActorTypes: ['human', 'agent', 'workflow'] },
  { command: 'SubmitFeedback',     riskLevel: 'R1', allowedRoles: ['client'], allowedActorTypes: ['human', 'agent'] },
  { command: 'RecordGratuity',     riskLevel: 'R2', allowedRoles: ['client'], allowedActorTypes: ['human', 'workflow'] },
  // Artisan operations
  { command: 'CheckInCustomer',    riskLevel: 'R2', allowedRoles: ['artisan', 'owner'], allowedActorTypes: ['human', 'workflow'] },
  { command: 'StartService',       riskLevel: 'R2', allowedRoles: ['artisan', 'owner'], allowedActorTypes: ['human', 'workflow'] },
  { command: 'CompleteService',    riskLevel: 'R2', allowedRoles: ['artisan', 'owner'], allowedActorTypes: ['human', 'workflow'] },
  // Owner operations
  { command: 'ReadOwnerDashboard', riskLevel: 'R0', allowedRoles: ['owner'], allowedActorTypes: ['human', 'agent'] },
  // Financial (R3 — requires human approval)
  { command: 'IssueRefund',        riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ReleasePayout',      riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ResolveDispute',     riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'SuspendProvider',    riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  // Notifications
  { command: 'SendNotification',   riskLevel: 'R1', allowedRoles: ['system', 'owner', 'artisan'], allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  // Approvals
  { command: 'CreateApprovalRequest', riskLevel: 'R1', allowedRoles: ['*'], allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  { command: 'ResolveApprovalRequest', riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
];

export class AuthorizationService {
  private permissions: Map<string, CommandPermission>;

  constructor(extra: CommandPermission[] = []) {
    this.permissions = new Map(
      [...DEFAULT_PERMISSIONS, ...extra].map((p) => [p.command, p]),
    );
  }

  authorize(command: string, ctx: OperationContext): { allowed: boolean; reason?: string; riskLevel: RiskLevel } {
    const perm = this.permissions.get(command);
    if (!perm) {
      return { allowed: false, reason: `Unknown command: ${command}`, riskLevel: 'R4' };
    }

    const roleOk =
      perm.allowedRoles.includes('*') || perm.allowedRoles.includes(ctx.role);
    if (!roleOk) {
      return { allowed: false, reason: `Role '${ctx.role}' not permitted for ${command}`, riskLevel: perm.riskLevel };
    }

    const actorOk = perm.allowedActorTypes.includes(ctx.actor.actorType);
    if (!actorOk) {
      return { allowed: false, reason: `Actor type '${ctx.actor.actorType}' not permitted for ${command}`, riskLevel: perm.riskLevel };
    }

    return { allowed: true, riskLevel: perm.riskLevel };
  }

  getRiskLevel(command: string): RiskLevel {
    return this.permissions.get(command)?.riskLevel ?? 'R4';
  }

  requiresApproval(riskLevel: RiskLevel): boolean {
    return riskLevel === 'R3' || riskLevel === 'R4';
  }
}
