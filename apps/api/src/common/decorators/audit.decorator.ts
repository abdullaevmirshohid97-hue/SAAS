import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'auditConfig';

export interface AuditConfig {
  action: string;
  resourceType: string;
  idempotent?: boolean;
}

export const Audit = (config: AuditConfig) => SetMetadata(AUDIT_KEY, config);
