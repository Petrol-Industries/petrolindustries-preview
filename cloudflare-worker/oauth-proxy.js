/**
 * Shared Cloudflare Worker for:
 *  (1) Decap CMS GitHub OAuth proxy — /auth and /callback (for YOU, the site owner)
 *  (2) Contact form submissions — POST /contact-submit (sends email via Resend)
 *  (3) Staff content editor API — /staff-login, /staff-get, /staff-save, /staff-image
 *      A username/password login for non-technical colleagues that edits content
 *      directly on the live site WITHOUT ever giving them a GitHub account or repo
 *      access. This Worker holds a GitHub service token that does the actual
 *      commits on their behalf, scoped to a fixed allowlist of content files and
 *      a "must already exist under src/assets/img/" rule for image replacement —
 *      they can never touch templates, CSS, JS, or the deploy workflow.
 *
 * This one Worker backs BOTH the Petrol and Indigold season preview sites — no
 * need to deploy a second Worker or set up a second OAuth App / service token.
 *
 * === OAuth setup (one-time, for your own Decap /admin login) ===
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
 *      - CONTACT_FROM_EMAIL   (optional — defaults to onboarding@resend.dev)
 * 3. Each site's contact form POSTs JSON to https://<worker-subdomain>.workers.dev/contact-submit.
 *
 * === Staff editor setup (one-time) ===
 * 1. Create a GitHub fine-grained Personal Access Token scoped ONLY to the
 *    petrolindustries-preview and indigold-preview repos, with Contents:
 *    Read and write permission — nothing else. This token is what actually
 *    commits changes; your colleagues never see or use it.
 * 2. Add to the Worker's Variables and Secrets:
 *      - GITHUB_SERVICE_TOKEN   (secret) — the token from step 1
 *      - CMS_USERS              (secret) — JSON, e.g. {"jane":"herPassword123"}
 *      - SESSION_SECRET         (secret) — any long random string, used to sign
 *                                login sessions (e.g. generate one at
 *                                https://1password.com/password-generator/)
 * 2. Give your colleagues the /staff/ URL on each site plus their username/password.
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

// Staff editor: fixed allowlists. Nothing outside these can ever be read or written.
const STAFF_REPOS = {
  petrol: "Petrol-Industries/petrolindustries-preview",
  indigold: "Petrol-Industries/indigold-preview",
};

const STAFF_FILES = {
  home: "src/_data/home.yaml",
  contacts: "src/_data/contacts.yaml",
  contact: "src/_data/contact.yaml",
  site: "src/_data/site.yaml",
};

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signSession(username, secret) {
  const payload = JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

async function verifySession(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(sigB64),
    new TextEncoder().encode(payloadB64)
  );
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.u;
}

function requireBearer(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

async function githubApi(path, env, opts = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      "Authorization": `token ${env.GITHUB_SERVICE_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "petrol-staff-editor-worker",
      ...(opts.headers || {}),
    },
  });
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
      if (!code) return new Response("Missing code", { status: 400 });

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
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });

      let data;
      try {
        data = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, origin);
      }

      const { name, company, region, email, phone, message, site } = data;
      if (!name || !region || !email || !message) {
        return jsonResponse({ ok: false, error: "Missing required fields" }, 400, origin);
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
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: toEmail, reply_to: email, subject, text: textBody }),
      });

      if (!resendRes.ok) {
        const errText = await resendRes.text();
        return jsonResponse({ ok: false, error: "Email send failed", detail: errText }, 502, origin);
      }

      return jsonResponse({ ok: true }, 200, origin);
    }

    // ---------- Staff editor API ----------

    if (url.pathname === "/staff-login") {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });

      let data;
      try {
        data = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, origin);
      }

      const { username, password } = data;
      let users = {};
      try {
        users = JSON.parse(env.CMS_USERS || "{}");
      } catch {
        return jsonResponse({ ok: false, error: "Server misconfigured" }, 500, origin);
      }

      if (!username || !password || users[username] !== password) {
        return jsonResponse({ ok: false, error: "Invalid username or password" }, 401, origin);
      }

      const token = await signSession(username, env.SESSION_SECRET);
      return jsonResponse({ ok: true, token }, 200, origin);
    }

    if (url.pathname === "/staff-get") {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

      const token = requireBearer(request);
      const user = await verifySession(token, env.SESSION_SECRET);
      if (!user) return jsonResponse({ ok: false, error: "Not authenticated" }, 401, origin);

      const site = url.searchParams.get("site");
      const file = url.searchParams.get("file");
      const repo = STAFF_REPOS[site];
      const path = STAFF_FILES[file];
      if (!repo || !path) return jsonResponse({ ok: false, error: "Unknown site or file" }, 400, origin);

      const ghRes = await githubApi(`/repos/${repo}/contents/${path}`, env);
      if (!ghRes.ok) return jsonResponse({ ok: false, error: "Could not read file" }, 502, origin);
      const ghData = await ghRes.json();
      const content = base64ToUtf8(ghData.content);
      return jsonResponse({ ok: true, content, sha: ghData.sha }, 200, origin);
    }

    if (url.pathname === "/staff-save") {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });

      const token = requireBearer(request);
      const user = await verifySession(token, env.SESSION_SECRET);
      if (!user) return jsonResponse({ ok: false, error: "Not authenticated" }, 401, origin);

      let data;
      try {
        data = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, origin);
      }

      const { site, file, content, sha } = data;
      const repo = STAFF_REPOS[site];
      const path = STAFF_FILES[file];
      if (!repo || !path || typeof content !== "string" || !sha) {
        return jsonResponse({ ok: false, error: "Invalid request" }, 400, origin);
      }

      const putRes = await githubApi(`/repos/${repo}/contents/${path}`, env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Content update by ${user} via staff editor`,
          content: utf8ToBase64(content),
          sha,
          branch: "main",
        }),
      });

      if (!putRes.ok) {
        const errText = await putRes.text();
        return jsonResponse({ ok: false, error: "Save failed — the file may have changed since you loaded it. Reload and try again.", detail: errText }, 409, origin);
      }

      const putData = await putRes.json();
      return jsonResponse({ ok: true, sha: putData.content.sha }, 200, origin);
    }

    if (url.pathname === "/staff-image") {
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });

      const token = requireBearer(request);
      const user = await verifySession(token, env.SESSION_SECRET);
      if (!user) return jsonResponse({ ok: false, error: "Not authenticated" }, 401, origin);

      let data;
      try {
        data = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, origin);
      }

      const { site, path, contentBase64 } = data;
      const repo = STAFF_REPOS[site];
      if (!repo || !path || !contentBase64) {
        return jsonResponse({ ok: false, error: "Invalid request" }, 400, origin);
      }
      // Images may only be REPLACED, never created or moved: must already exist
      // under src/assets/img/, and no path traversal.
      if (!path.startsWith("src/assets/img/") || path.includes("..")) {
        return jsonResponse({ ok: false, error: "Path not allowed" }, 403, origin);
      }

      const existingRes = await githubApi(`/repos/${repo}/contents/${path}`, env);
      if (!existingRes.ok) {
        return jsonResponse({ ok: false, error: "That image does not exist yet — only existing images can be replaced" }, 404, origin);
      }
      const existing = await existingRes.json();

      const putRes = await githubApi(`/repos/${repo}/contents/${path}`, env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Image replaced by ${user} via staff editor`,
          content: contentBase64,
          sha: existing.sha,
          branch: "main",
        }),
      });

      if (!putRes.ok) {
        const errText = await putRes.text();
        return jsonResponse({ ok: false, error: "Image upload failed", detail: errText }, 502, origin);
      }

      return jsonResponse({ ok: true }, 200, origin);
    }

    return new Response("Worker is running.", { status: 200 });
  },
};
