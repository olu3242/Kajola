export type ApiResponse<T> = {
  data: T;
  error?: string;
};

export type UserRole = 'super_admin' | 'tenant_admin' | 'artisan' | 'client';

export type Tenant = {
  id: string;
  name: string;
  type: 'individual' | 'business' | 'cooperative';
};

export * from './endpoints';
