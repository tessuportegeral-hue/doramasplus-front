// Service worker do DoramasPlus — só cuida de push notification por enquanto.
// Registrado em src/lib/pushNotifications.js.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'DoramasPlus', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'DoramasPlus';
  const options = {
    body: data.body || '',
    icon: '/android-chrome-192x192.png',
    // Sem "badge": o Android sempre mascara esse ícone pra monocromático
    // (só usa a transparência) — como o logo é uma imagem cheia sem fundo
    // transparente, virava uma bolinha genérica na barra de status. Sem
    // essa propriedade o sistema usa um ícone neutro em vez disso.
    data: { url: data.url || '/' },
  };

  // Pôster do dorama em destaque (recomendação diária) — aparece grande
  // na notificação, igual apps de streaming grandes fazem. IMPORTANTE: o
  // Android só mostra a imagem e os botões de ação quando a notificação
  // está EXPANDIDA (arrasta pra baixo / toca na setinha) — recolhida,
  // mostra só ícone + título + texto, é comportamento normal do sistema.
  if (data.image) options.image = data.image;
  if (data.cta) options.actions = [{ action: 'open', title: data.cta }];

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
