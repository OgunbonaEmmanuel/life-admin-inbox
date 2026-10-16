import { api } from './api';
export async function enablePush(publicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    throw new Error('This browser does not support web push. Email reminders are still available.');
  if (!publicKey) throw new Error('Browser push is not configured on the server yet.');
  // Called only from the explicit Enable button, never during page load.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(
      'Notification permission was not granted. You can change this in your browser site settings; email is unaffected.',
    );
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
  const bytes = Uint8Array.from(
    atob((publicKey + padding).replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  await api('/push-subscriptions', subscription.toJSON());
  await api('/profile', { pushEnabled: true }, 'PATCH');
}
export async function unsubscribeBrowser() {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      try {
        await api('/push-subscriptions', { endpoint: subscription.endpoint }, 'DELETE');
      } finally {
        await subscription.unsubscribe();
      }
    }
  }
}
export async function disablePush() {
  await unsubscribeBrowser();
  await api('/profile', { pushEnabled: false }, 'PATCH');
}
