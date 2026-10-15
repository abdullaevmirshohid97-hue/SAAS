// =============================================================================
// Bulutli ATS (klinika IP-telefoniyasi) — API turlari
// =============================================================================

export type PbxDialFormat = 'e164' | 'digits12' | 'local9';

export interface PbxServerInfo {
  /** Asterisk serveri sozlanganmi (PBX_SIP_DOMAIN) */
  configured: boolean;
  sip_domain: string | null;
  sip_port: number;
  wss_url: string | null;
  turn_configured: boolean;
}

export interface PbxTenant {
  clinic_id: string;
  code: string;
  enabled: boolean;
  provider: string;
  trunk_host: string | null;
  trunk_port: number;
  trunk_transport: 'udp' | 'tcp';
  trunk_username: string | null;
  trunk_from_domain: string | null;
  did: string | null;
  dial_format: PbxDialFormat;
  ring_timeout_sec: number;
  after_hours: 'ring' | 'ai';
  /** Hech kim olmasa: ovozli xabar | AI qabulxona | faqat xabar */
  no_answer: 'voicemail' | 'ai' | 'message';
  max_outbound: number;
  /** voice-agent xabari: Registered | Unregistered | Rejected | ... */
  trunk_status: string | null;
  trunk_status_at: string | null;
  updated_at: string | null;
  has_password: boolean;
}

export interface PbxTenantInput {
  enabled: boolean;
  trunk_host: string | null;
  trunk_port: number;
  trunk_transport: 'udp' | 'tcp';
  trunk_username: string | null;
  /** Bo'sh qoldirilsa — eski parol saqlanadi */
  trunk_password?: string | null;
  trunk_from_domain: string | null;
  did: string | null;
  dial_format: PbxDialFormat;
  ring_timeout_sec: number;
  after_hours: 'ring' | 'ai';
  no_answer: 'voicemail' | 'ai' | 'message';
  max_outbound: number;
}

export interface PbxExtension {
  id: string;
  ext: string;
  label: string;
  profile_id: string | null;
  profile_name: string | null;
  in_ring_group: boolean;
  can_call_out: boolean;
  is_active: boolean;
  phone_status: 'online' | 'offline' | null;
  web_status: 'online' | 'offline' | null;
  status_at: string | null;
  phone_username: string;
}

export interface PbxStaffOption {
  id: string;
  full_name: string;
  role: string;
}

export interface PbxSettingsOverview {
  server: PbxServerInfo;
  tenant: PbxTenant | null;
  extensions: PbxExtension[];
  staff: PbxStaffOption[];
}

/** Super admin: klinikaning ATS holati (parolsiz). */
export interface PbxAdminOverview {
  server: PbxServerInfo;
  tenant: PbxTenant | null;
  extensions: PbxExtension[];
  month: { calls: number; missed: number };
}

export interface PbxExtensionCredentials {
  ext: string;
  label: string;
  server: string | null;
  port: number;
  transport: string;
  username: string;
  password: string | null;
  realm: string;
}

export interface PbxIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Softfon akkaunti (joriy foydalanuvchi). */
export type PbxSoftphoneAccount =
  | {
      enabled: false;
      reason: 'tenant_disabled' | 'server_not_configured' | 'no_extension';
    }
  | {
      enabled: true;
      ext: string;
      display_name: string;
      ws_url: string;
      sip_domain: string;
      uri: string;
      username: string;
      ha1: string;
      realm: string;
      ice_servers: PbxIceServer[];
    };

export interface PbxDirectoryEntry {
  ext: string;
  label: string;
  phone_status: string | null;
  web_status: string | null;
}

export interface PbxLookupResult {
  phone: string;
  patients: Array<{
    id: string;
    full_name: string;
    phone: string | null;
    dob: string | null;
    next_appointment: { scheduled_at: string; doctor_name: string | null } | null;
  }>;
}

export type PbxCallStatus = 'answered' | 'missed' | 'ai' | 'voicemail' | 'busy' | 'failed';

export interface PbxCallListItem {
  id: string;
  uuid: string;
  direction: 'in' | 'out' | 'internal';
  status: PbxCallStatus;
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  answered_sec: number | null;
  duration_sec: number | null;
  needs_callback: boolean;
  callback_done_at: string | null;
  ai_call_id: string | null;
  has_recording: boolean;
  /** Ovozli xabar matni (o'zimizning STT serveri bo'lsa) */
  transcript: string | null;
  patient: { id: string; full_name: string } | null;
  extension: { id: string; ext: string; label: string } | null;
}
