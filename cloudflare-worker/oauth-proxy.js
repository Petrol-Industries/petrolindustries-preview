/**
 * Decap CMS GitHub OAuth proxy — deploy as a Cloudflare Worker.
 *
 * Setup:
 * 1. Deploy this file as a new Cloudflare Worker (dashboard: Workers & Pages -> Create -> paste this code).
 * 2. Create a GitHub OAuth App under the Petrol-Industries org
 *    (https://github.com/organizations/Petrol-Industries/settings/applications):
 *      - Homepage URL: https://petrol-industries.github.io/petrolindustries-preview/
 *      - Authorization callback URL: https://<your-worker-subdomain>.workers.dev/callback
 * 3. In the Worker's Settings -> Variables, add two secrets (encrypt both):
 *      - GITHUB_CLIENT_ID
 *      - GITHUB_CLIENT_SECRET
 * 4. In admin/config.yml, add `base_url: https://<your-worker-subdomain>.workers.dev`
 *    under the `backend:` section.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    return new Response("Decap CMS OAuth proxy is running.", { status: 200 });
  },
};
