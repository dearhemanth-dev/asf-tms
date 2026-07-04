self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "New maintenance alert" };
  }

  const title = payload.title || "ASF TMS Alert";
  const body = payload.body || "New maintenance alert";
  const url = payload.url || "/maintenance/fault-codes";
  const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : undefined;

  const options = {
    body,
    data: { url },
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    requireInteraction: true,
  };

  if (tag) {
    options.tag = tag;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "/maintenance/fault-codes", self.location.origin).toString();

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) {
              await client.navigate(targetUrl);
            }
            return;
          }
        } catch {
          // Ignore malformed client URLs and continue.
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
