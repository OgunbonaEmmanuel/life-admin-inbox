self.addEventListener('push', event => {
  let message={};try{message=event.data?.json()||{};}catch{}
  // Do not show document titles, amounts or excerpts on the lock screen.
  event.waitUntil(self.registration.showNotification('A little reminder',{
    body:'An obligation needs your attention. Open your private inbox.',
    tag:typeof message.tag==='string'?message.tag:'life-admin',
    icon:'/favicon.svg',data:{url:'/'},renotify:false
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(client=>new URL(client.url).origin===self.location.origin);
    return existing?existing.focus():self.clients.openWindow('/');
  }));
});
// Private API responses and originals are intentionally never cached offline.
