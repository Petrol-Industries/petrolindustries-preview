/**
 * Shared Cloudflare Worker for:
 *  (1) Decap CMS GitHub OAuth proxy — /auth and /callback
 *  (2) Contact form submissions — POST /contact-submit (sends email via Resend)
 *
 * This one Worker backs BOTH the Petrol and Indigold season preview sites —
 * no need to deploy a second Worker or OAuth App for the second site.
 *
 * === OAuth setup (one-time) ===
 * 1. Deploy this file as a Cloudflare Worker (dashboard: Workers & Pages -> Create -> paste this code).
 * 2. Create a GitHub OAuth App under the Petrol-Industries org
 *    (https://github.com/organizations/Petrol-Industries/settings/applications):
 *      - Callback URL: https://<your-worker-subdomain>.workers.dev/callback
 * 3. In the Worker's Settings -> Variables and Secrets, add (encrypt both):
 *      - GITHUB_CLIENT_ID
 *      - GITHUB_CLIENT_SECRET
 * 4. In each site's admin/config.yml, set `base_url: https://<your-worker-subdomain>.workers.dev`.
 *
 * === Contact form setup (one-time) ===
 * 1. Sign up free at https://resend.com and create an API key.
 * 2. Add to the Worker's Variables and Secrets:
 *      - RESEND_API_KEY       (secret)
 *      - CONTACT_FROM_EMAIL   (optional — defaults to onboarding@resend.dev,
 *                              which works immediately with no domain setup;
 *                              use your own verified domain once you have one)
 * 3. Each site's contact form POSTs JSON to https://<worker-subdomain>.workers.dev/contact-submit
 *    with a `site` field ("petrol" or "indigold") that the SITE_RECIPIENTS map
 *    below routes to the right inbox — already wired into main.js and each
 *    site's contact.yaml, nothing else to configure.
 */

const SITE_RECIPIENTS = {
  petrol: "customerservice@petrolindustries.com",
  indigold: "customerservice@indigoldcrafted.com",
};

const SITE_SUBJECT_PREFIXES = {
  petrol: "Form reply Petrol Preview website:",
  indigold: "Form reply Indigold Preview website:",
};

const ALLOWED_ORIGINS = [
  "https://petrol-industries.github.io",
  "https://preview.petrolindustries.com",
  "https://preview.indigoldcrafted.com",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (url.pathname === "/auth") {
      const authUrl = new URL("https://github.com/login/oauth/authorize");
      authUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
      authUrl.searchParams.set("scope", "repo,user");
      return Response.redirect(authUrl.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Missing code", { status: 400 });
      }

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        return new Response(`OAuth error: ${tokenData.error_description || tokenData.error}`, { status: 400 });
      }

      const message = `authorization:github:success:${JSON.stringify({ token: tokenData.access_token, provider: "github" })}`;

      const html = `<!DOCTYPE html><html><body>
<script>
  (function() {
    function receiveMessage(e) {
      window.opener.postMessage(${JSON.stringify(message)}, e.origin);
      window.removeEventListener("message", receiveMessage, false);
    }
    window.addEventListener("message", receiveMessage, false);
    window.opener.postMessage("authorizing:github", "*");
  })();
</script>
</body></html>`;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    if (url.pathname === "/contact-submit") {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders(origin) });
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
      }

      let data;
      try {
        data = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      const { name, company, region, email, phone, message, site } = data;
      if (!name || !region || !email || !message) {
        return new Response(JSON.stringify({ ok: false, error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      const toEmail = SITE_RECIPIENTS[site] || env.CONTACT_TO_EMAIL || "sales@petrolindustries.com";
      const fromEmail = env.CONTACT_FROM_EMAIL || "onboarding@resend.dev";
      const prefix = SITE_SUBJECT_PREFIXES[site] || "Form reply:";
      const subject = `${prefix} Region: ${region}, Company: ${company || name}`;
      const textBody = [
        `Name: ${name}`,
        company ? `Company: ${company}` : "",
        `Region: ${region}`,
        `Email: ${email}`,
        phone ? `Phone: ${phone}` : "",
        site ? `Site: ${site}` : "",
        "",
        message,
      ].filter(Boolean).join("\n");

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: toEmail,
          reply_to: email,
          subject,
          text: textBody,
        }),
      });

      if (!resendRes.ok) {
        const errText = await resendRes.text();
        return new Response(JSON.stringify({ ok: false, error: "Email send failed", detail: errText }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    return new Response("Worker is running.", { status: 200 });
  },
};
