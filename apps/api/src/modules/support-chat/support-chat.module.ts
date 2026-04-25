import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const OpenThreadSchema = z.object({ subject: z.string().min(3), priority: z.enum(['low','normal','high','urgent']).default('normal') });
const SendMessageSchema = z.object({ content: z.string().min(1), is_internal_note: z.boolean().default(false), attachments: z.array(z.unknown()).optional() });

@Injectable()
class SupportChatService {
  constructor(private readonly supabase: SupabaseService) {}

  async listThreads(clinicId: string) {
    const { data } = await this.supabase.admin().from('support_threads').select('*').eq('clinic_id', clinicId).order('last_message_at', { ascending: false });
    return data ?? [];
  }

  async openThread(clinicId: string, userId: string, input: z.infer<typeof OpenThreadSchema>) {
    const { data } = await this.supabase.admin().from('support_threads').insert({ clinic_id: clinicId, opened_by: userId, subject: input.subject, priority: input.priority }).select().single();
    return data;
  }

  async getMessages(threadId: string) {
    const { data } = await this.supabase.admin().from('support_messages').select('*').eq('thread_id', threadId).order('sent_at');
    return data ?? [];
  }

  async sendMessage(threadId: string, clinicId: string, authorId: string, authorKind: string, input: z.infer<typeof SendMessageSchema>) {
    const { data } = await this.supabase.admin().from('support_messages').insert({
      thread_id: threadId, clinic_id: clinicId, author_id: authorId, author_kind: authorKind,
      content: input.content, is_internal_note: input.is_internal_note, attachments: input.attachments ?? [],
    }).select().single();
    await this.supabase.admin().from('support_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
    return data;
  }

  async markRead(messageId: string) {
    await this.supabase.admin().from('support_messages').update({ read_at: new Date().toISOString() }).eq('id', messageId);
    return { ok: true };
  }

  async setTyping(threadId: string, userId: string) {
    await this.supabase.admin().from('support_typing_indicators').upsert({ thread_id: threadId, user_id: userId, last_typed_at: new Date().toISOString() });
    return { ok: true };
  }
}

@ApiTags('support-chat')
@Controller('support-chat')
class SupportChatController {
  constructor(private readonly svc: SupportChatService) {}

  @Get('threads')
  threads(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listThreads(u.clinicId);
  }

  @Post('threads')
  open(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.openThread(u.clinicId, u.userId, OpenThreadSchema.parse(body));
  }

  @Get('threads/:id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getMessages(id);
  }

  @Post('threads/:id/messages')
  send(
    @CurrentUser() u: { clinicId: string | null; userId: string | null; role: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const kind = u.role === 'super_admin' ? 'super_admin' : 'clinic';
    return this.svc.sendMessage(id, u.clinicId, u.userId, kind, SendMessageSchema.parse(body));
  }

  @Patch('messages/:id/read')
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(id);
  }

  @Post('threads/:id/typing')
  typing(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.setTyping(id, u.userId);
  }
}

@Module({
  controllers: [SupportChatController],
  providers: [SupportChatService, SupabaseService],
})
export class SupportChatModule {}
