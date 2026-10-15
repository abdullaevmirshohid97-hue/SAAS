// =============================================================================
// Bulutli ATS — Clary API (GET /telephony/agent/config) javobi
// =============================================================================
// Manba: apps/api/src/modules/telephony/pbx.service.ts (AgentConfig)

export type PbxDialFormat = 'e164' | 'digits12' | 'local9';

export interface PbxTrunk {
  host: string;
  port: number;
  transport: 'udp' | 'tcp';
  username: string;
  password: string;
  from_domain: string;
  did: string | null;
  dial_format: PbxDialFormat;
}

export interface PbxExtensionConf {
  ext: string;
  label: string;
  phone_user: string;
  phone_ha1: string;
  web_user: string;
  web_ha1: string;
  ring: boolean;
  can_call_out: boolean;
}

export interface PbxTenantConf {
  code: string;
  clinic_id: string;
  name: string;
  trunk: PbxTrunk | null;
  ring_timeout: number;
  record: boolean;
  ai_fallback: 'ai' | 'none';
  after_hours: 'ring' | 'ai';
  hours: Array<{ weekday: number; start: string; end: string }>;
  closed_dates: string[];
  max_outbound: number;
  extensions: PbxExtensionConf[];
}

export interface PbxAgentConfig {
  realm: string;
  generated_at: string;
  tenants: PbxTenantConf[];
}
