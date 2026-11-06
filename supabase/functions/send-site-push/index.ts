import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Content-Type": "application/json"
};
const jsonResponse = (status: number, body: Record<string, unknown>) =>
	new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
	if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
	if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

	const authorization = request.headers.get("authorization") || "";
	const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!accessToken) return jsonResponse(401, { error: "Authentication required." });
	const supabaseUrl = Deno.env.get("SUPABASE_URL");
	const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
	const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
	const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
	const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
	const vapidSubject = Deno.env.get("VAPID_SUBJECT");
	if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
		console.error("Push sender is missing required Supabase or VAPID configuration.");
		return jsonResponse(503, { error: "Push sender is not configured." });
	}

	const userClient = createClient(supabaseUrl, anonKey, {
		global: { headers: { Authorization: `Bearer ${accessToken}` } },
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
	if (userError || !userData.user) return jsonResponse(401, { error: "Invalid session." });
	const { data: isOwner, error: ownerError } = await userClient.rpc("is_feedback_site_owner");
	if (ownerError || isOwner !== true) return jsonResponse(403, { error: "Only the verified site owner can send notifications." });

	let bodyValue: unknown;
	try {
		bodyValue = await request.json();
	} catch {
		return jsonResponse(400, { error: "Invalid JSON body." });
	}
	if (!bodyValue || typeof bodyValue !== "object" || Array.isArray(bodyValue)) {
		return jsonResponse(400, { error: "Invalid JSON body." });
	}
	const body = bodyValue as Record<string, unknown>;
	if (
		typeof body.title !== "string" || body.title.trim().length < 1 || body.title.length > 100
		|| typeof body.body !== "string" || body.body.trim().length < 1 || body.body.length > 200
	) {
		return jsonResponse(400, { error: "Invalid notification title or body." });
	}
	const origin = request.headers.get("origin");
	if (!origin || typeof body.url !== "string") return jsonResponse(400, { error: "Invalid site URL." });
	let siteOrigin: string;
	let targetUrl: URL;
	try {
		siteOrigin = new URL(origin).origin;
		targetUrl = new URL(body.url);
	} catch {
		return jsonResponse(400, { error: "Invalid site URL." });
	}
	if (targetUrl.origin !== siteOrigin || targetUrl.protocol !== "https:") {
		return jsonResponse(400, { error: "Notification links must stay on the secure site origin." });
	}

	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { data: subscriptions, error: subscriptionsError } = await admin
		.from("site_push_subscriptions")
		.select("endpoint,p256dh,auth");
	if (subscriptionsError) {
		console.error("Could not load push subscriptions:", subscriptionsError.message);
		return jsonResponse(500, { error: "Could not load notification subscribers." });
	}

	webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
	const payload = JSON.stringify({
		title: body.title.trim(),
		body: body.body.trim(),
		icon: new URL("./channels4_profile.jpg", siteOrigin).href,
		badge: new URL("./channels4_profile.jpg", siteOrigin).href,
		url: targetUrl.href
	});
	const results = await Promise.all((subscriptions || []).map(async (subscription) => {
		try {
			await webpush.sendNotification({
				endpoint: subscription.endpoint,
				keys: { p256dh: subscription.p256dh, auth: subscription.auth }
			}, payload, { TTL: 86400 });
			return { sent: true, endpoint: subscription.endpoint };
		} catch (error) {
			const statusCode = Number((error as { statusCode?: number }).statusCode);
			if (statusCode === 404 || statusCode === 410) {
				const { error: deleteError } = await admin
					.from("site_push_subscriptions")
					.delete()
					.eq("endpoint", subscription.endpoint);
				if (deleteError) console.error("Could not remove expired push subscription:", deleteError.message);
			} else {
				console.error("Push delivery failed:", statusCode || "unknown status");
			}
			return { sent: false, endpoint: subscription.endpoint };
		}
	}));
	const sent = results.filter((result) => result.sent).length;
	return jsonResponse(200, { sent, failed: results.length - sent });
});
