// ============================================================
// send-bulk-sms — admin-triggered campaigns: pre_event_reminder,
// livestream_alert, post_event_thank_you, invite_contacts.
// Requires an authenticated admin caller.
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { requireAdmin, sendSms } from '../_shared/supabase-admin.ts';

const MESSAGE_BUILDERS: Record<string, (ctx: any) => string> = {
  pre_event_reminder: (ctx) =>
    ctx.message?.trim() || `Reminder: ${ctx.conferenceName} is coming up soon at ${ctx.venue}. We can't wait to see you!`,
  livestream_alert: (ctx) =>
    ctx.message?.trim() || `${ctx.conferenceName} is live now! Watch: ${ctx.facebook_live_url || ctx.youtube_live_url || ''}`,
  post_event_thank_you: (ctx) =>
    ctx.message?.trim() || `Thank you for attending ${ctx.conferenceName}! We're grateful you joined us.`,
  invite_contacts: (ctx) => ctx.message,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { admin, user } = await requireAdmin(req);
    const body = await req.json();
    const { campaign_type, batch_label, message, facebook_live_url, youtube_live_url, target_audience } = body;

    if (!MESSAGE_BUILDERS[campaign_type]) {
      return new Response(JSON.stringify({ error: 'Unknown campaign type' }), { status: 400, headers: corsHeaders });
    }

    const { data: settings } = await admin.from('conference_settings').select('*').limit(1).single();
    const text = MESSAGE_BUILDERS[campaign_type]({
      conferenceName: settings?.conference_name,
      venue: settings?.venue,
      facebook_live_url: facebook_live_url || settings?.facebook_live_url,
      youtube_live_url: youtube_live_url || settings?.youtube_live_url,
      message,
    });

    // Recipient list depends on campaign type and target_audience
    let recipients: { phone: string }[] = [];

    if (campaign_type === 'invite_contacts') {
      const { data } = await admin.from('invitations').select('contact_phone').eq('batch_label', batch_label).eq('sms_sent', false);
      recipients = (data ?? []).map((r) => ({ phone: r.contact_phone }));
    } else if (target_audience === 'all_saved_and_registered' || target_audience === 'all') {
      // Both registered attendees AND all saved contacts (deduplicated)
      const { data: regs } = await admin.from('registrants').select('contact_phone');
      const { data: invs } = await admin.from('invitations').select('contact_phone');
      const phoneSet = new Set<string>();
      (regs ?? []).forEach((r) => r.contact_phone && phoneSet.add(r.contact_phone));
      (invs ?? []).forEach((i) => i.contact_phone && phoneSet.add(i.contact_phone));
      recipients = Array.from(phoneSet).map((p) => ({ phone: p }));
    } else {
      const { data } = await admin.from('registrants').select('contact_phone');
      recipients = (data ?? []).map((r) => ({ phone: r.contact_phone }));
    }

    let sentCount = 0;
    for (const r of recipients) {
      const result = await sendSms(admin, {
        phone: r.phone,
        message: text,
        campaignType: campaign_type,
        sentBy: user.id,
      });
      if (result.status === 'sent') sentCount++;
    }

    if (campaign_type === 'invite_contacts') {
      await admin.from('invitations')
        .update({ sms_sent: true, sms_sent_at: new Date().toISOString() })
        .eq('batch_label', batch_label);
    }

    return new Response(
      JSON.stringify({ sent: sentCount, total: recipients.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
