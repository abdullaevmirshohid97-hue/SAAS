export interface SendResult {
  providerMessageId: string;
  status: 'sent' | 'queued' | 'failed';
  raw?: unknown;
  error?: string;
}

export interface SmsInput {
  to: string;
  text: string;
  from?: string;
  idempotencyKey?: string;
}

export interface EmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string | Buffer }>;
  idempotencyKey?: string;
}

export interface PushInput {
  to: string; // device token
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SmsAdapter {
  readonly name: string;
  send(input: SmsInput): Promise<SendResult>;
}

export interface EmailAdapter {
  readonly name: string;
  send(input: EmailInput): Promise<SendResult>;
}

export interface PushAdapter {
  readonly name: string;
  send(input: PushInput): Promise<SendResult>;
}

export type Credentials = Record<string, string | undefined>;
