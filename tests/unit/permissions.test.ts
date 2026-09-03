import { describe, it, expect } from 'vitest';

// ── RBAC permission model ─────────────────────────────────────────────────────
// These tests mirror the server-side permission logic enforced in Edge Functions.
// No DB/network — pure logic only.

type Role = 'super_admin' | 'tenant_admin' | 'artisan' | 'client';

interface User {
  id:        string;
  tenant_id: string;
  role:      Role;
}

// Permissions a role has
const ROLE_PERMISSIONS: Record<Role, string[]> = {
  super_admin:  ['*'],
  tenant_admin: ['booking:read', 'booking:write', 'artisan:manage', 'payment:read', 'report:read'],
  artisan:      ['booking:read_own', 'service:manage_own', 'availability:manage_own', 'payment:read_own'],
  client:       ['booking:create', 'booking:read_own', 'booking:cancel_own', 'payment:create', 'review:create_own'],
};

function hasPermission(user: User, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[user.role] ?? [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  // Check wildcard: 'booking:*' matches 'booking:read'
  const [resource] = permission.split(':');
  return perms.includes(`${resource}:*`);
}

function canAccessBooking(user: User, booking: { client_id: string; artisan_id: string; tenant_id: string }): boolean {
  if (user.tenant_id !== booking.tenant_id) return false;
  if (user.role === 'super_admin' || user.role === 'tenant_admin') return true;
  if (user.role === 'artisan')      return user.id === booking.artisan_id;
  if (user.role === 'client')       return user.id === booking.client_id;
  return false;
}

function canModifyService(user: User, service: { artisan_id: string; tenant_id: string }): boolean {
  if (user.tenant_id !== service.tenant_id) return false;
  if (user.role === 'super_admin' || user.role === 'tenant_admin') return true;
  if (user.role === 'artisan') return user.id === service.artisan_id;
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const admin:   User = { id: 'admin-1',   tenant_id: TENANT_A, role: 'tenant_admin' };
const artisan: User = { id: 'artisan-1', tenant_id: TENANT_A, role: 'artisan' };
const client:  User = { id: 'client-1',  tenant_id: TENANT_A, role: 'client' };
const otherClient: User = { id: 'client-2', tenant_id: TENANT_A, role: 'client' };
const crossTenantClient: User = { id: 'client-x', tenant_id: TENANT_B, role: 'client' };

const booking = { client_id: 'client-1', artisan_id: 'artisan-1', tenant_id: TENANT_A };

describe('Role permissions', () => {
  it('clients can create bookings', () => {
    expect(hasPermission(client, 'booking:create')).toBe(true);
  });

  it('clients cannot manage artisan services', () => {
    expect(hasPermission(client, 'service:manage_own')).toBe(false);
  });

  it('artisans can manage their own availability', () => {
    expect(hasPermission(artisan, 'availability:manage_own')).toBe(true);
  });

  it('artisans cannot access payment reports', () => {
    expect(hasPermission(artisan, 'report:read')).toBe(false);
  });

  it('tenant admin can read payments', () => {
    expect(hasPermission(admin, 'payment:read')).toBe(true);
  });

  it('super admin has all permissions', () => {
    const superAdmin: User = { id: 'sa-1', tenant_id: 'any', role: 'super_admin' };
    expect(hasPermission(superAdmin, 'any:permission')).toBe(true);
  });
});

describe('Booking IDOR protection', () => {
  it('client can access own booking', () => {
    expect(canAccessBooking(client, booking)).toBe(true);
  });

  it('other client cannot access booking they do not own', () => {
    expect(canAccessBooking(otherClient, booking)).toBe(false);
  });

  it('artisan can access booking for their services', () => {
    expect(canAccessBooking(artisan, booking)).toBe(true);
  });

  it('tenant admin can access all bookings in their tenant', () => {
    expect(canAccessBooking(admin, booking)).toBe(true);
  });

  it('cross-tenant user is denied regardless of role', () => {
    expect(canAccessBooking(crossTenantClient, booking)).toBe(false);
    const crossTenantAdmin: User = { id: 'x-admin', tenant_id: TENANT_B, role: 'tenant_admin' };
    expect(canAccessBooking(crossTenantAdmin, booking)).toBe(false);
  });
});

describe('Service modification rules', () => {
  const service = { artisan_id: 'artisan-1', tenant_id: TENANT_A };

  it('artisan can modify their own service', () => {
    expect(canModifyService(artisan, service)).toBe(true);
  });

  it('different artisan cannot modify someone else service', () => {
    const otherArtisan: User = { id: 'artisan-2', tenant_id: TENANT_A, role: 'artisan' };
    expect(canModifyService(otherArtisan, service)).toBe(false);
  });

  it('tenant admin can modify any service in their tenant', () => {
    expect(canModifyService(admin, service)).toBe(true);
  });

  it('client cannot modify services', () => {
    expect(canModifyService(client, service)).toBe(false);
  });
});

describe('Tenant isolation', () => {
  it('all data access checks include tenant_id verification', () => {
    const crossTenantArtisan: User = { id: 'artisan-1', tenant_id: TENANT_B, role: 'artisan' };
    // Same artisan_id, different tenant — must be denied
    expect(canAccessBooking(crossTenantArtisan, booking)).toBe(false);
    expect(canModifyService(crossTenantArtisan, { artisan_id: 'artisan-1', tenant_id: TENANT_A })).toBe(false);
  });
});
