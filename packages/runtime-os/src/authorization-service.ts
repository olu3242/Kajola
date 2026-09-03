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
  { command: 'CreatePaymentIntent',riskLevel: 'R2', allowedRoles: ['client', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system', 'webhook'] },
  { command: 'ConfirmBooking',     riskLevel: 'R2', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system', 'webhook'] },
  { command: 'CancelBooking',      riskLevel: 'R2', allowedRoles: ['client', 'owner', 'artisan', 'system'], allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  { command: 'CreateRebooking',    riskLevel: 'R1', allowedRoles: ['client', 'owner'], allowedActorTypes: ['human', 'agent', 'workflow'] },
  { command: 'SubmitFeedback',     riskLevel: 'R1', allowedRoles: ['client'], allowedActorTypes: ['human', 'agent'] },
  { command: 'RecordGratuity',     riskLevel: 'R2', allowedRoles: ['client'], allowedActorTypes: ['human', 'workflow'] },
  // Artisan operations
  { command: 'CheckInCustomer',    riskLevel: 'R2', allowedRoles: ['artisan', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'StartService',       riskLevel: 'R2', allowedRoles: ['artisan', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'CompleteService',    riskLevel: 'R2', allowedRoles: ['artisan', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  // Owner operations
  { command: 'ReadOwnerDashboard', riskLevel: 'R0', allowedRoles: ['owner'], allowedActorTypes: ['human', 'agent'] },
  // Financial (R3 — requires human approval)
  { command: 'IssueRefund',        riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ReleasePayout',      riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ResolveDispute',     riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'SuspendProvider',    riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  // Notifications
  { command: 'SendNotification',   riskLevel: 'R1', allowedRoles: ['system', 'owner', 'artisan'], allowedActorTypes: ['human', 'agent', 'workflow', 'system'] },
  // Booking lifecycle commands
  { command: 'RequestBooking',        riskLevel: 'R1', allowedRoles: ['client'], allowedActorTypes: ['human', 'agent'] },
  { command: 'AcceptBooking',         riskLevel: 'R2', allowedRoles: ['artisan', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'DeclineBooking',        riskLevel: 'R2', allowedRoles: ['artisan', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'RescheduleBooking',     riskLevel: 'R2', allowedRoles: ['client', 'artisan', 'owner'], allowedActorTypes: ['human', 'agent', 'workflow'] },
  { command: 'MarkBookingPaid',       riskLevel: 'R2', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system', 'webhook'] },
  { command: 'RequestReview',         riskLevel: 'R1', allowedRoles: ['system', 'owner'], allowedActorTypes: ['workflow', 'system'] },
  { command: 'PublishReview',         riskLevel: 'R1', allowedRoles: ['client'], allowedActorTypes: ['human', 'agent'] },
  // Provider lifecycle
  { command: 'RegisterProvider',      riskLevel: 'R1', allowedRoles: ['*'], allowedActorTypes: ['human'] },
  { command: 'CompleteProviderProfile', riskLevel: 'R1', allowedRoles: ['artisan', 'owner'], allowedActorTypes: ['human'] },
  { command: 'SubmitKYC',             riskLevel: 'R2', allowedRoles: ['artisan', 'owner'], allowedActorTypes: ['human'] },
  { command: 'VerifyProvider',        riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ActivateProvider',      riskLevel: 'R2', allowedRoles: ['system', 'owner'], allowedActorTypes: ['workflow', 'system', 'human'] },
  { command: 'SuspendProvider',       riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ReactivateProvider',    riskLevel: 'R2', allowedRoles: ['owner'], allowedActorTypes: ['human', 'workflow'] },
  // Customer lifecycle
  { command: 'RegisterCustomer',      riskLevel: 'R1', allowedRoles: ['*'], allowedActorTypes: ['human'] },
  { command: 'TagCustomerSegment',    riskLevel: 'R1', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system'] },
  { command: 'SendRetentionOffer',    riskLevel: 'R1', allowedRoles: ['system', 'owner'], allowedActorTypes: ['workflow', 'system', 'agent'] },
  // Service delivery
  { command: 'MarkProviderEnRoute',   riskLevel: 'R2', allowedRoles: ['artisan', 'system'], allowedActorTypes: ['human', 'workflow'] },
  { command: 'MarkProviderArrived',   riskLevel: 'R2', allowedRoles: ['artisan', 'system'], allowedActorTypes: ['human', 'workflow'] },
  { command: 'UploadServiceEvidence', riskLevel: 'R2', allowedRoles: ['artisan', 'owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'CustomerConfirmComplete', riskLevel: 'R2', allowedRoles: ['client'], allowedActorTypes: ['human', 'agent'] },
  // Payment lifecycle
  { command: 'CreateQuote',           riskLevel: 'R1', allowedRoles: ['artisan', 'owner'], allowedActorTypes: ['human', 'agent'] },
  { command: 'AcceptQuote',           riskLevel: 'R2', allowedRoles: ['client'], allowedActorTypes: ['human', 'agent'] },
  { command: 'RecordDepositPaid',     riskLevel: 'R2', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system', 'webhook'] },
  { command: 'RecordBalancePaid',     riskLevel: 'R2', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system', 'webhook'] },
  { command: 'InitiatePayout',        riskLevel: 'R3', allowedRoles: ['system', 'owner'], allowedActorTypes: ['workflow', 'human'] },
  { command: 'ReleasePayout',         riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'RefundDeposit',         riskLevel: 'R3', allowedRoles: ['owner', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'IssueRefund',           riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  // Dispute
  { command: 'OpenDispute',           riskLevel: 'R2', allowedRoles: ['client', 'artisan', 'owner'], allowedActorTypes: ['human'] },
  { command: 'SubmitDisputeEvidence', riskLevel: 'R2', allowedRoles: ['client', 'artisan', 'system'], allowedActorTypes: ['human', 'workflow', 'system'] },
  { command: 'ReviewDispute',         riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ResolveDispute',        riskLevel: 'R3', allowedRoles: ['owner'], allowedActorTypes: ['human'] },
  { command: 'ApplyDisputeResolution', riskLevel: 'R3', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system'] },
  // Reputation
  { command: 'UpdateTrustScore',      riskLevel: 'R1', allowedRoles: ['system'], allowedActorTypes: ['workflow', 'system'] },
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
