// Manual field picker mode. Lets the AE click inputs on the prospect's page
// and tag each as email/first_name/etc. when our automatic detection misses.
// Picks are saved per-domain in chrome.storage.local so future visits "just work."
//
// Exposes window.DefaultDemo.picker = { enter, exit, isActive, loadSavedPicks }

(function () {
  const ns = window.DefaultDemo;
  const BRAND = ns.BRAND;

  const STORAGE_KEY = (host) => `picks_${host}`;
  const FIELD_OPTIONS = [
    { tag: "email",      label: "Email"      },
    { tag: "first_name", label: "First name" },
    { tag: "last_name",  label: "Last name"  },
    { tag: "full_name",  label: "Full name"  },
    { tag: "company",    label: "Company"    },
    { tag: "title",      label: "Title"      },
    { tag: "phone",      label: "Phone"      },
    { tag: "employees",  label: "Employees"  }
  ];

  let active = false;
  let host = null;          // shadow host
  let shadow = null;
  let overlayEl = null;     // hover highlight rectangle
  let menuEl = null;        // tagging popover
  let bannerEl = null;
  let doneBtnEl = null;
  let hoveredInput = null;
  let picks = []; // [{ selector, tag, element }]

  function isInteractiveInput(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) return false;
    if (!el.getBoundingClientRect().width) return false;
    return true;
  }

  function cssPathFor(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && path.length < 8) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) {
        const cls = Array.from(node.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
        part += cls;
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) {
          const idx = sameTag.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function ensureMounted() {
    if (host && document.documentElement.contains(host)) return;

    host = document.createElement("div");
    host.id = "default-demo-picker-host";
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;";
    document.documentElement.appendChild(host);

    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Inter", -apple-system, system-ui, sans-serif; }
        .banner {
          position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
          background: ${BRAND.purple}; color: ${BRAND.white};
          padding: 10px 16px; border-radius: 6px;
          font-size: 13px; font-weight: 500;
          box-shadow: 0 8px 24px rgba(99, 0, 255, 0.45);
          pointer-events: auto;
          display: flex; align-items: center; gap: 12px;
        }
        .banner .hint { font-weight: 400; opacity: 0.85; font-size: 12px; }
        .done {
          position: fixed; top: 16px; right: 16px;
          background: ${BRAND.white}; color: ${BRAND.black};
          padding: 8px 14px; border-radius: 6px;
          font-size: 13px; font-weight: 600;
          border: none; cursor: pointer;
          pointer-events: auto;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        .highlight {
          position: absolute; pointer-events: none;
          border: 2px solid ${BRAND.purple};
          background: rgba(99, 0, 255, 0.08);
          border-radius: 4px;
          transition: top 60ms ease, left 60ms ease, width 60ms ease, height 60ms ease;
          opacity: 0;
        }
        .menu {
          position: absolute; pointer-events: auto;
          background: ${BRAND.black}; color: ${BRAND.white};
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px; padding: 6px;
          box-shadow: 0 16px 32px rgba(0, 0, 0, 0.6);
          display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
          min-width: 220px;
        }
        .menu button {
          background: transparent; color: ${BRAND.white};
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 4px; padding: 6px 8px;
          font-size: 12px; cursor: pointer; text-align: left;
        }
        .menu button:hover { border-color: ${BRAND.purple}; background: rgba(99, 0, 255, 0.15); }
        .pick-tag {
          position: absolute; pointer-events: none;
          background: ${BRAND.purple}; color: ${BRAND.white};
          font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
          padding: 2px 6px; border-radius: 3px;
          box-shadow: 0 4px 12px rgba(99, 0, 255, 0.4);
        }
      </style>
      <div class="banner">
        <span>Pick form fields</span>
        <span class="hint">click an input to tag · ESC to exit</span>
      </div>
      <button class="done">Done</button>
      <div class="highlight"></div>
    `;

    bannerEl = shadow.querySelector(".banner");
    doneBtnEl = shadow.querySelector(".done");
    overlayEl = shadow.querySelector(".highlight");

    doneBtnEl.addEventListener("click", finish);
  }

  function positionHighlight(target) {
    if (!target) {
      overlayEl.style.opacity = "0";
      return;
    }
    const r = target.getBoundingClientRect();
    overlayEl.style.opacity = "1";
    overlayEl.style.top = `${r.top - 4}px`;
    overlayEl.style.left = `${r.left - 4}px`;
    overlayEl.style.width = `${r.width + 8}px`;
    overlayEl.style.height = `${r.height + 8}px`;
  }

  function onMouseMove(event) {
    if (!active) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target && isInteractiveInput(target)) {
      hoveredInput = target;
      positionHighlight(target);
    } else {
      hoveredInput = null;
      positionHighlight(null);
    }
  }

  function onClick(event) {
    if (!active) return;
    // Ignore clicks inside our shadow host UI.
    if (event.target === host || (event.composedPath && event.composedPath().includes(host))) return;

    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || !isInteractiveInput(target)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    showMenu(target, event.clientX, event.clientY);
  }

  function onKey(event) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    }
  }

  function showMenu(target, x, y) {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "menu";
    menuEl.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menuEl.style.top = `${Math.min(y + 8, window.innerHeight - 240)}px`;

    FIELD_OPTIONS.forEach(({ tag, label }) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => tagInput(target, tag, label));
      menuEl.appendChild(b);
    });
    shadow.appendChild(menuEl);
  }

  function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
  }

  function tagInput(input, tag, label) {
    closeMenu();
    const selector = cssPathFor(input);
    if (!selector) return;
    // Replace any previous pick for this element.
    picks = picks.filter((p) => p.element !== input);
    picks.push({ selector, tag, label, element: input });
    drawPickTag(input, label);
  }

  function drawPickTag(input, label) {
    // Remove any previous tag for this element.
    shadow.querySelectorAll(`.pick-tag[data-target-id="${input.dataset?.ddPickId || ""}"]`).forEach((el) => el.remove());

    const id = (input.dataset.ddPickId = input.dataset.ddPickId || `dd_${Math.random().toString(36).slice(2, 9)}`);
    const r = input.getBoundingClientRect();
    const tag = document.createElement("div");
    tag.className = "pick-tag";
    tag.dataset.targetId = id;
    tag.textContent = label;
    tag.style.top = `${r.top - 18}px`;
    tag.style.left = `${r.left}px`;
    shadow.appendChild(tag);
  }

  async function persistPicks() {
    if (!chrome.storage?.local) return;
    const serialized = picks.map(({ selector, tag, label }) => ({ selector, tag, label }));
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY(location.hostname)]: serialized }, () => resolve());
      } catch (e) { resolve(); }
    });
  }

  async function loadSavedPicks() {
    if (!chrome.storage?.local) return [];
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [STORAGE_KEY(location.hostname)]: [] }, (data) => {
          resolve(data[STORAGE_KEY(location.hostname)] || []);
        });
      } catch (e) { resolve([]); }
    });
  }

  function readSavedPicksFromDOM(saved) {
    return saved
      .map(({ selector, tag, label }) => {
        try {
          const el = document.querySelector(selector);
          if (!el) return null;
          return { selector, tag, label, element: el };
        } catch (e) { return null; }
      })
      .filter(Boolean);
  }

  async function enter() {
    if (active) return;
    if (window !== window.top) return; // picker only runs in top frame
    active = true;
    ensureMounted();
    picks = [];

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  async function finish() {
    if (!active) return;
    active = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    closeMenu();

    if (host) {
      host.remove();
      host = null;
      shadow = null;
      overlayEl = null;
    }

    if (picks.length === 0) return;

    await persistPicks();

    // Open overlay populated with the picked field values.
    const formData = {};
    picks.forEach((p) => {
      let value = "";
      try { value = p.element?.value ?? ""; } catch (e) {}
      formData[p.tag] = value;
    });
    if (ns.overlay?.open) {
      ns.overlay.open({
        formData,
        vendor: "manual",
        sourceUrl: location.hostname,
        force: true
      });
    }
  }

  function exit() {
    finish();
  }

  function isActive() { return active; }

  ns.picker = {
    enter,
    exit,
    isActive,
    loadSavedPicks,
    readSavedPicksFromDOM,
    storageKey: STORAGE_KEY(location.hostname)
  };
})();
