self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = {};
	}

	const title = typeof payload.title === "string" ? payload.title : "Desconhecido MP3";
	const icon = new URL("./channels4_profile.jpg", self.registration.scope).href;
	const options = {
		body: typeof payload.body === "string" ? payload.body : "Há uma nova publicação no site.",
		icon,
		badge: icon,
		data: { url: typeof payload.url === "string" ? payload.url : self.registration.scope }
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const requestedUrl = event.notification.data?.url;
	let targetUrl = self.registration.scope;
	try {
		const candidate = new URL(requestedUrl, self.registration.scope);
		if (candidate.origin === self.location.origin) targetUrl = candidate.href;
	} catch {
		targetUrl = self.registration.scope;
	}

	event.waitUntil((async () => {
		const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
		for (const client of windows) {
			if (client.url.startsWith(self.registration.scope) && "focus" in client) {
				await client.navigate(targetUrl);
				return client.focus();
			}
		}
		return self.clients.openWindow(targetUrl);
	})());
});
