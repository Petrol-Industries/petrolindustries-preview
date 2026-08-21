/**
 * Staff content editor — no GitHub account needed.
 * Talks only to the Cloudflare Worker's /staff-* API, which holds the real
 * GitHub credentials. This page can only ever touch the four known content
 * files and existing images under src/assets/img/ — nothing else.
 *
 * Expects `window.STAFF_CONFIG = { site: 'petrol'|'indigold', apiBase: '...' }`
 * to be set by an inline script in the host HTML page before this file loads.
 */
(function () {
  const CONFIG = window.STAFF_CONFIG;
  const TOKEN_KEY = `staff_token_${CONFIG.site}`;
  const FILES = ["home", "contacts", "contact", "site"];
  const state = { token: null, data: {}, sha: {} };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const app = $("#staff-app");

  function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
    return fetch(CONFIG.apiBase + path, Object.assign({}, opts, { headers }));
  }

  // ---------- Path-based get/set on plain objects/arrays ----------
  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split(".");
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = /^\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i];
      if (cur[k] == null) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      cur = cur[k];
    }
    const lastKey = keys[keys.length - 1];
    cur[/^\d+$/.test(lastKey) ? Number(lastKey) : lastKey] = value;
  }

  // ---------- Tiny DOM helper ----------
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function field(labelText, path, value, type) {
    const wrap = h("div", { class: "sf-field" });
    wrap.appendChild(h("label", { text: labelText }));
    const input =
      type === "textarea"
        ? h("textarea", { rows: "4", "data-path": path })
        : h("input", { type: type || "text", "data-path": path });
    input.value = value == null ? "" : value;
    wrap.appendChild(input);
    return wrap;
  }

  function section(title, contentEl, onSave) {
    const details = h("details", { class: "sf-section", open: "" });
    details.appendChild(h("summary", { text: title }));
    const body = h("div", { class: "sf-body" });
    body.appendChild(contentEl);
    const status = h("span", { class: "sf-status" });
    const saveBtn = h("button", { type: "button", class: "sf-save", text: "Save" });
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      status.textContent = "Saving…";
      status.className = "sf-status";
      try {
        await onSave(body);
        status.textContent = "Saved ✓";
        status.className = "sf-status sf-status--ok";
      } catch (err) {
        status.textContent = err.message || "Save failed";
        status.className = "sf-status sf-status--error";
      } finally {
        saveBtn.disabled = false;
      }
    });
    const bar = h("div", { class: "sf-savebar" }, [saveBtn, status]);
    body.appendChild(bar);
    details.appendChild(body);
    return details;
  }

  function collect(body, obj) {
    body.querySelectorAll("[data-path]").forEach((inputEl) => {
      setPath(obj, inputEl.getAttribute("data-path"), inputEl.value);
    });
    return obj;
  }

  async function saveFile(fileKey, mutate) {
    const obj = state.data[fileKey];
    mutate(obj);
    const content = jsyaml.dump(obj, { lineWidth: -1 });
    const res = await api("/staff-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: CONFIG.site, file: fileKey, content, sha: state.sha[fileKey] }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.error || "Save failed");
    state.sha[fileKey] = result.sha;
  }

  function imageField(labelText, imagePath, altPath, altValue) {
    const wrap = h("div", { class: "sf-field sf-image-field" });
    wrap.appendChild(h("label", { text: labelText }));
    const preview = h("img", { src: `../${imagePath}`, class: "sf-preview" });
    const fileInput = h("input", { type: "file", accept: "image/*" });
    const status = h("span", { class: "sf-status" });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      status.textContent = "Uploading…";
      status.className = "sf-status";
      try {
        const contentBase64 = await fileToBase64(file);
        // imagePath is the site-relative URL used in the built page (e.g.
        // "assets/img/x.jpg"); the actual repo path is under src/, since
        // Eleventy's input dir is "src".
        const res = await api("/staff-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site: CONFIG.site, path: `src/${imagePath}`, contentBase64 }),
        });
        const result = await res.json();
        if (!res.ok || !result.ok) throw new Error(result.error || "Upload failed");
        preview.src = `../${imagePath}?t=${Date.now()}`;
        status.textContent = "Replaced ✓ (may take a minute to appear live)";
        status.className = "sf-status sf-status--ok";
      } catch (err) {
        status.textContent = err.message;
        status.className = "sf-status sf-status--error";
      }
    });
    wrap.appendChild(preview);
    wrap.appendChild(fileInput);
    wrap.appendChild(status);
    if (altPath) {
      wrap.appendChild(field("Alt text (for accessibility)", altPath, altValue));
    }
    return wrap;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- Section renderers ----------
  function renderHome(data) {
    const frag = h("div", {});

    frag.appendChild(
      section(
        "Hero",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Season label", "hero.season_label", data.hero.season_label));
          c.appendChild(field("Heading — line 1", "hero.heading_line1", data.hero.heading_line1));
          c.appendChild(field("Heading — line 2", "hero.heading_line2", data.hero.heading_line2));
          c.appendChild(field("Lede text", "hero.lede", data.hero.lede, "textarea"));
          c.appendChild(imageField("Hero image", data.hero.image, "hero.image_alt", data.hero.image_alt));
          return c;
        })(),
        (body) => saveFile("home", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Brand DNA",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Eyebrow", "dna.eyebrow", data.dna.eyebrow));
          c.appendChild(field("Heading", "dna.heading", data.dna.heading));
          data.dna.paragraphs.forEach((p, i) => c.appendChild(field(`Paragraph ${i + 1}`, `dna.paragraphs.${i}`, p, "textarea")));
          c.appendChild(field("Quote", "dna.quote", data.dna.quote, "textarea"));
          c.appendChild(imageField("DNA image", data.dna.image, "dna.image_alt", data.dna.image_alt));
          c.appendChild(field("Image tag (small badge on photo)", "dna.image_tag", data.dna.image_tag));
          return c;
        })(),
        (body) => saveFile("home", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Brand Values",
        (() => {
          const c = h("div", {});
          data.values.forEach((v, i) => c.appendChild(field(`Value ${v.num}`, `values.${i}.label`, v.label)));
          return c;
        })(),
        (body) => saveFile("home", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Gallery",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Eyebrow", "gallery.eyebrow", data.gallery.eyebrow));
          c.appendChild(field("Heading", "gallery.heading", data.gallery.heading));
          c.appendChild(field("Intro", "gallery.intro", data.gallery.intro, "textarea"));
          data.gallery.items.forEach((item, i) => {
            const tileWrap = h("div", { class: "sf-tile" });
            tileWrap.appendChild(h("h4", { text: `Tile ${i + 1} (${item.type === "video" ? "video" : item.size || "normal"})` }));
            if (item.type === "video") {
              tileWrap.appendChild(field("YouTube video ID", `gallery.items.${i}.youtube_id`, item.youtube_id));
            } else {
              tileWrap.appendChild(imageField("Photo", item.image, null));
            }
            tileWrap.appendChild(field("Caption", `gallery.items.${i}.caption`, item.caption));
            tileWrap.appendChild(field("Alt text", `gallery.items.${i}.alt`, item.alt));
            c.appendChild(tileWrap);
          });
          return c;
        })(),
        (body) => saveFile("home", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Facts & Figures",
        (() => {
          const c = h("div", {});
          data.stats.forEach((s, i) => {
            const row = h("div", { class: "sf-row" });
            row.appendChild(field("Value", `stats.${i}.value`, s.value));
            row.appendChild(field("Label", `stats.${i}.label`, s.label));
            c.appendChild(row);
          });
          return c;
        })(),
        (body) => saveFile("home", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Closing CTA Band",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Eyebrow", "cta.eyebrow", data.cta.eyebrow));
          c.appendChild(field("Heading", "cta.heading", data.cta.heading));
          c.appendChild(field("Text", "cta.text", data.cta.text, "textarea"));
          return c;
        })(),
        (body) => saveFile("home", (obj) => collect(body, obj))
      )
    );

    return frag;
  }

  function renderContacts(data) {
    const frag = h("div", {});
    frag.appendChild(
      section(
        "Page Header",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Eyebrow", "page.eyebrow", data.page.eyebrow));
          c.appendChild(field("Heading", "page.heading", data.page.heading));
          c.appendChild(field("Intro", "page.intro", data.page.intro, "textarea"));
          c.appendChild(field("Footnote", "footnote", data.footnote, "textarea"));
          return c;
        })(),
        (body) => saveFile("contacts", (obj) => collect(body, obj))
      )
    );

    data.groups.forEach((group, gi) => {
      frag.appendChild(
        section(
          `Group: ${group.label}`,
          (() => {
            const c = h("div", {});
            group.people.forEach((p, pi) => {
              const pWrap = h("div", { class: "sf-tile" });
              pWrap.appendChild(h("h4", { text: p.region }));
              pWrap.appendChild(field("Name", `groups.${gi}.people.${pi}.name`, p.name));
              pWrap.appendChild(field("Email", `groups.${gi}.people.${pi}.email`, p.email));
              pWrap.appendChild(field("Phone (displayed)", `groups.${gi}.people.${pi}.phone_display`, p.phone_display));
              c.appendChild(pWrap);
            });
            return c;
          })(),
          (body) => saveFile("contacts", (obj) => collect(body, obj))
        )
      );
    });

    return frag;
  }

  function renderContact(data) {
    const frag = h("div", {});
    frag.appendChild(
      section(
        "Contact Page",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Eyebrow", "page.eyebrow", data.page.eyebrow));
          c.appendChild(field("Heading", "page.heading", data.page.heading));
          c.appendChild(field("Intro", "page.intro", data.page.intro, "textarea"));
          c.appendChild(field("Form note (small print under Submit)", "form_note", data.form_note, "textarea"));
          return c;
        })(),
        (body) => saveFile("contact", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Info Card",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Heading", "info_card.heading", data.info_card.heading));
          data.info_card.rows.forEach((r, i) => {
            const row = h("div", { class: "sf-row" });
            row.appendChild(field(r.label, `info_card.rows.${i}.value`, r.value));
            c.appendChild(row);
          });
          return c;
        })(),
        (body) => saveFile("contact", (obj) => collect(body, obj))
      )
    );

    return frag;
  }

  function renderSite(data) {
    const frag = h("div", {});
    frag.appendChild(
      section(
        "Brand & Access",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Brand tagline (next to logo)", "brand.tagline", data.brand.tagline));
          c.appendChild(field("Preview access code", "access.password", data.access.password));
          return c;
        })(),
        (body) => saveFile("site", (obj) => collect(body, obj))
      )
    );

    frag.appendChild(
      section(
        "Footer",
        (() => {
          const c = h("div", {});
          c.appendChild(field("Description", "footer.description", data.footer.description, "textarea"));
          c.appendChild(field("Markets line", "footer.countries", data.footer.countries, "textarea"));
          c.appendChild(field("Legal line (left)", "footer.legal", data.footer.legal));
          c.appendChild(field("Legal line (right)", "footer.legal_right", data.footer.legal_right));
          return c;
        })(),
        (body) => saveFile("site", (obj) => collect(body, obj))
      )
    );

    return frag;
  }

  // ---------- Boot ----------
  async function loadAll() {
    app.innerHTML = "";
    app.appendChild(h("p", { class: "sf-loading", text: "Loading content…" }));
    try {
      for (const fileKey of FILES) {
        const res = await api(`/staff-get?site=${CONFIG.site}&file=${fileKey}`);
        const result = await res.json();
        if (res.status === 401) return showLogin("Session expired — please log in again.");
        if (!res.ok || !result.ok) throw new Error(result.error || `Could not load ${fileKey}`);
        state.data[fileKey] = jsyaml.load(result.content);
        state.sha[fileKey] = result.sha;
      }
    } catch (err) {
      app.innerHTML = "";
      app.appendChild(h("p", { class: "sf-error", text: `Error loading content: ${err.message}` }));
      return;
    }

    app.innerHTML = "";
    const topBar = h("div", { class: "sf-topbar" }, [
      h("span", { text: `Editing ${CONFIG.site === "petrol" ? "Petrol" : "Indigold"} content` }),
      (() => {
        const btn = h("button", { type: "button", class: "sf-logout", text: "Log out" });
        btn.addEventListener("click", logout);
        return btn;
      })(),
    ]);
    app.appendChild(topBar);
    app.appendChild(renderHome(state.data.home));
    app.appendChild(renderContacts(state.data.contacts));
    app.appendChild(renderContact(state.data.contact));
    app.appendChild(renderSite(state.data.site));
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    state.token = null;
    showLogin();
  }

  function showLogin(message) {
    app.innerHTML = "";
    const userInput = h("input", { type: "text", placeholder: "Username", autocomplete: "username" });
    const passInput = h("input", { type: "password", placeholder: "Password", autocomplete: "current-password" });
    const status = h("p", { class: "sf-status" });
    if (message) status.textContent = message;
    const form = h("form", { class: "sf-login" }, [
      h("h2", { text: "Staff Login" }),
      userInput,
      passInput,
      h("button", { type: "submit", text: "Log In" }),
      status,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "Logging in…";
      status.className = "sf-status";
      try {
        const res = await fetch(CONFIG.apiBase + "/staff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: userInput.value, password: passInput.value }),
        });
        const result = await res.json();
        if (!res.ok || !result.ok) throw new Error(result.error || "Login failed");
        state.token = result.token;
        localStorage.setItem(TOKEN_KEY, result.token);
        loadAll();
      } catch (err) {
        status.textContent = err.message;
        status.className = "sf-status sf-status--error";
      }
    });
    app.appendChild(form);
  }

  const savedToken = localStorage.getItem(TOKEN_KEY);
  if (savedToken) {
    state.token = savedToken;
    loadAll();
  } else {
    showLogin();
  }
})();
