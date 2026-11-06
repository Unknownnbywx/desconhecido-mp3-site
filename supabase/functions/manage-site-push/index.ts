import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Content-Type": "application/json"
};
const allowedPushHosts = new Set([
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
	"push.services.mozilla.com",
	"web.push.apple.com"
]);

const jsonResponse = (status: number, body: Record<string, unknown>) =>
	new Response(JSON.stringify(body), { status, headers: corsHeaders });

const getClientIpHash = async (request: Request) => {
	const ipAddress = request.headers.get("cf-connecting-ip")
		|| request.headers.get("x-forwarded-for")?.split(",")[0].trim();
	if (!ipAddress) return null;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ipAddress));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (request) => {
	if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
	if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

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

	if (body.action === "config") {
		const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
		if (!vapidPublicKey) return jsonResponse(503, { error: "Push is not configured." });
		return jsonResponse(200, { vapidPublicKey });
	}

	if (body.action !== "subscribe" && body.action !== "unsubscribe") {
		return jsonResponse(400, { error: "Invalid action." });
	}
	const subscription = body.subscription;
	if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
		return jsonResponse(400, { error: "Invalid subscription." });
	}
	const details = subscription as Record<string, unknown>;
	if (typeof details.endpoint !== "string" || details.endpoint.length > 2048) {
		return jsonResponse(400, { error: "Invalid subscription endpoint." });
	}
	let endpoint: URL;
	try {
		endpoint = new URL(details.endpoint);
	} catch {
		return jsonResponse(400, { error: "Invalid subscription endpoint." });
	}
	if (
		endpoint.protocol !== "https:"
		|| endpoint.username
		|| endpoint.password
		|| endpoint.port
		|| !allowedPushHosts.has(endpoint.hostname)
	) {
		return jsonResponse(400, { error: "Unsupported push service." });
	}

	const supabaseUrl = Deno.env.get("SUPABASE_URL");
	const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
	if (!supabaseUrl || !serviceRoleKey) {
		console.error("Push subscription storage is missing Supabase server configuration.");
		return jsonResponse(503, { error: "Push storage is not configured." });
	}
	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	if (body.action === "unsubscribe") {
		const { error } = await admin.from("site_push_subscriptions").delete().eq("endpoint", endpoint.href);
		if (error) {
			console.error("Could not remove push subscription:", error.message);
			return jsonResponse(500, { error: "Could not remove subscription." });
		}
		return jsonResponse(200, { ok: true });
	}

	const keys = details.keys;
	if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
		return jsonResponse(400, { error: "Invalid subscription keys." });
	}
	const keyDetails = keys as Record<string, unknown>;
	if (
		typeof keyDetails.p256dh !== "string"
		|| !/^[A-Za-z0-9_-]{40,100}$/.test(keyDetails.p256dh)
		|| typeof keyDetails.auth !== "string"
		|| !/^[A-Za-z0-9_-]{16,64}$/.test(keyDetails.auth)
	) {
		return jsonResponse(400, { error: "Invalid subscription keys." });
	}

	const clientIpHash = await getClientIpHash(request);
	if (!clientIpHash) return jsonResponse(400, { error: "Could not identify the client for rate limiting." });
	const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const { count, error: countError } = await admin
		.from("site_push_subscriptions")
		.select("endpoint", { count: "exact", head: true })
		.eq("client_ip_hash", clientIpHash)
		.gte("created_at", cutoff);
	if (countError) {
		console.error("Could not check push subscription rate limit:", countError.message);
		return jsonResponse(500, { error: "Could not validate subscription rate." });
	}
	const { data: existing, error: existingError } = await admin
		.from("site_push_subscriptions")
		.select("endpoint")
		.eq("endpoint", endpoint.href)
		.maybeSingle();
	if (existingError) {
		console.error("Could not check existing push subscription:", existingError.message);
		return jsonResponse(500, { error: "Could not validate subscription." });
	}
	if (!existing && (count ?? 0) >= 10) return jsonResponse(429, { error: "Too many subscriptions from this device network." });

	const { error } = await admin.from("site_push_subscriptions").upsert({
		endpoint: endpoint.href,
		p256dh: keyDetails.p256dh,
		auth: keyDetails.auth,
		client_ip_hash: clientIpHash
	});
	if (error) {
		console.error("Could not save push subscription:", error.message);
		return jsonResponse(500, { error: "Could not save subscription." });
	}
	return jsonResponse(200, { ok: true });
});
