import webpush from 'web-push';
import { config } from './config.js';
import type { Profile } from '../shared/types.js';
export class DeliveryBlocked extends Error {}
export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
export interface Delivery {
  email(profile: Profile, key: string): Promise<string>;
  push(subscription: webpush.PushSubscription, key: string): Promise<void>;
}
export const delivery: Delivery = {
  async email(profile, key) {
    if (config.emailProvider !== 'resend' || !config.resendKey || !config.emailFrom)
      throw new DeliveryBlocked('Email provider is not configured.');
    if (!config.production && (!config.testEmail || profile.email !== config.testEmail))
      throw new DeliveryBlocked('Development email requires an exact configured test destination.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [profile.email],
        subject: 'A little reminder from Life Admin Inbox',
        text: `You have an upcoming obligation. Open your private inbox to see the details:\n${config.origin}\n\nManage reminders in Settings.`,
      }),
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    const result = (await response.json()) as { id?: string };
    if (!result.id) throw new Error('Email provider did not acknowledge acceptance.');
    return result.id;
  },
  async push(subscription, key) {
    if (!config.vapidPublic || !config.vapidPrivate || !config.vapidSubject)
      throw new DeliveryBlocked('Browser push is not configured.');
    if (!validPushEndpoint(subscription.endpoint))
      throw new DeliveryBlocked('Unsupported push service endpoint.');
    if (!config.production && !config.testPush.includes(subscription.endpoint))
      throw new DeliveryBlocked(
        'Development push requires an explicitly allowlisted test subscription.',
      );
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: 'A little reminder',
        body: 'An obligation needs your attention. Open your private inbox.',
        tag: key,
        url: '/',
      }),
      { TTL: 3600, timeout: 10_000, urgency: 'normal' },
    );
  },
};
