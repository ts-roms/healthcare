/* MyHealth service worker: shows push notifications and opens MyHealth when one is tapped.
 * A message carries only a title, one line and a page (the clinic never sends health details this way). */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "MyHealth";
  const options = {
    body: typeof data.body === "string" ? data.body : "You have a notification in MyHealth.",
    tag: "myhealth",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/messages" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
