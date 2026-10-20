(() => {
  "use strict";

  const Dom = () => globalThis.FillerDom;
  const Match = () => globalThis.FillerMatch;

  function clip(value) {
    return Dom().clip(value, 160);
  }

  function labelOf(el) {
    return el?.dataset?.fillerLabel || "Field";
  }

  function findAnchor(localId) {
    const selector = `[data-filler-id="${Dom().cssEscape(localId)}"]`;
    return Dom().queryAllDeep(selector)[0] || null;
  }

  function flash(el) {
    if (!el?.classList) return;
    el.classList.add("filler-flash");
    setTimeout(() => el.classList.remove("filler-flash"), 2200);
  }

  function truthy(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = Match().normalizeText(value);
    if (!text) return null;
    if (["false", "no", "n", "off", "unchecked", "0"].includes(text)) return false;
    if (text.startsWith("no ") || text.startsWith("not ") || text.startsWith("false ")) return false;
    if (["true", "yes", "y", "on", "checked", "1"].includes(text)) return true;
    if (text.startsWith("yes ") || text.startsWith("true ")) return true;
    return null;
  }

  function choiceNodes(anchor, selector) {
    const name = anchor.dataset.fillerName || "";
    if (name) {
      const form = anchor.closest("form");
      const scope = form || anchor.getRootNode() || document;
      return Dom().queryAllDeep(`${selector}[name="${Dom().cssEscape(name)}"]`, scope);
    }
    if (anchor.matches?.(selector)) return [anchor];
    return Dom().queryAllDeep(selector, anchor);
  }

  function optionLabel(el) {
    if (el.id) {
      const explicit = el.ownerDocument.querySelector(`label[for="${Dom().cssEscape(el.id)}"]`);
      if (explicit) return Dom().cleanText(explicit.textContent);
    }
    const wrapping = el.closest?.("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input, textarea, select").forEach((node) => node.remove());
      const text = Dom().cleanText(clone.textContent);
      if (text) return text;
    }
    return Dom().cleanText(el.getAttribute("aria-label") || el.value || el.textContent || "");
  }

  function notifyChoice(el) {
    Dom().fire(el, "input");
    Dom().fire(el, "change");
    Dom().blurField(el);
  }

  function setChecked(el, want) {
    if (el.getAttribute("role") === "checkbox" || el.getAttribute("role") === "radio") {
      const on = el.getAttribute("aria-checked") === "true";
      if (on !== want) Dom().clickLikeUser(el);
      if ((el.getAttribute("aria-checked") === "true") !== want) {
        el.setAttribute("aria-checked", want ? "true" : "false");
        notifyChoice(el);
      }
      return;
    }
    if (Boolean(el.checked) !== want) el.click();
    if (Boolean(el.checked) !== want) el.checked = want;
    notifyChoice(el);
  }

  function fillText(el, value) {
    if (el.matches?.("input[type='password'], input[type='hidden'], input[type='file']")) {
      return { ok: false, reason: "Skipped a sensitive input" };
    }
    const text = String(value);
    Dom().scrollIntoView(el);
    el.focus?.();
    Dom().setNativeValue(el, text);
    Dom().blurField(el);
    flash(el);
    return { ok: true, value: text };
  }

  function fillContentEditable(el, value) {
    const text = String(value);
    Dom().scrollIntoView(el);
    el.focus?.();
    const view = el.ownerDocument.defaultView;
    try {
      if (view.document.execCommand) {
        const selection = view.getSelection();
        const range = view.document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        view.document.execCommand("insertText", false, text);
      } else {
        throw new Error("execCommand unavailable");
      }
    } catch {
      el.textContent = text;
      Dom().fire(el, "input", text);
    }
    Dom().fire(el, "change");
    Dom().blurField(el);
    flash(el);
    return { ok: true, value: text };
  }

  async function fillSpinbutton(el, value) {
    const text = String(value).replace(/[^\d/-]/g, "");
    Dom().scrollIntoView(el);
    el.focus?.();
    Dom().clickLikeUser(el);
    if (el.matches("input, textarea")) {
      Dom().setNativeValue(el, text);
    } else {
      for (const char of text) {
        el.dispatchEvent(new (el.ownerDocument.defaultView.KeyboardEvent)("keydown", { key: char, bubbles: true, composed: true }));
        el.ownerDocument.execCommand?.("insertText", false, char);
      }
      if (!String(el.textContent || el.value || "").includes(text)) el.textContent = text;
      Dom().fire(el, "input", text);
      Dom().fire(el, "change");
    }
    Dom().blurField(el);
    flash(el);
    return { ok: true, value: text };
  }

  function selectMatch(el, value) {
    const options = [...el.options].map((option) => ({
      text: Dom().cleanText(option.textContent),
      value: option.value,
      extraTexts: [option.label || ""],
      el: option
    }));
    return Match().bestTextMatch(value, options);
  }

  function syncSelect(el) {
    const view = el.ownerDocument.defaultView;
    const jq = view.jQuery || view.$;
    if (!jq) return;
    try {
      jq(el).trigger("change");
    } catch {
      // Select2 is absent or the jQuery handle rejected the node.
    }
  }

  function fillSelect(el, value) {
    const wants = Array.isArray(value) ? value : [value];
    Dom().scrollIntoView(el);
    el.focus?.();
    if (el.multiple) {
      for (const option of el.options) option.selected = false;
      let any = false;
      for (const want of wants) {
        const match = selectMatch(el, want);
        if (match) {
          match.item.el.selected = true;
          any = true;
        }
      }
      if (!any) return { ok: false, reason: "No matching option" };
      Dom().fire(el, "input");
      Dom().fire(el, "change");
      syncSelect(el);
      Dom().blurField(el);
      flash(el);
      return { ok: true, value: [...el.selectedOptions].map((option) => Dom().cleanText(option.textContent)).join(", ") };
    }
    const match = selectMatch(el, wants[0]);
    if (!match) return { ok: false, reason: "No matching option" };
    Dom().setNativeValue(el, match.item.el.value);
    syncSelect(el);
    Dom().blurField(el);
    flash(el);
    return { ok: true, value: Dom().cleanText(match.item.el.textContent) };
  }

  function fillCheckbox(el, value) {
    const boxes = el.matches?.("input[type='checkbox'], [role='checkbox'], input[type='radio'], [role='radio']")
      ? [el]
      : choiceNodes(el, "input[type='checkbox'], [role='checkbox']");
    const target = boxes[0] || el;
    let want = truthy(value);
    if (want == null) {
      const wanted = Match().normalizeText(value);
      const label = Match().normalizeText(optionLabel(target));
      const close = wanted.length >= 4 && (label.includes(wanted) || wanted.includes(label));
      want = Boolean(wanted) && (wanted === label || close);
    }
    if (want === false && target.matches?.("input[type='radio'], [role='radio']")) {
      return { ok: true, unchanged: true };
    }
    setChecked(target, Boolean(want));
    flash(target);
    return { ok: true, value: want ? "Yes" : "No" };
  }

  function fillCheckboxGroup(anchor, value) {
    const boxes = choiceNodes(anchor, "input[type='checkbox'], [role='checkbox']");
    const wants = (Array.isArray(value) ? value : [value]).filter((want) => want !== false);
    const wanted = new Set();
    for (const want of wants) {
      const match = Match().bestTextMatch(want, boxes.map((box) => ({
        text: optionLabel(box),
        value: box.value || "",
        el: box
      })));
      if (match) wanted.add(match.item.el);
    }
    if (!wanted.size) return { ok: false, reason: "No matching option" };
    const chosen = [];
    for (const box of boxes) {
      const should = wanted.has(box);
      setChecked(box, should);
      if (should) chosen.push(optionLabel(box));
    }
    flash(anchor);
    return { ok: true, value: chosen.join(", ") };
  }

  function fillRadioGroup(anchor, value) {
    const radios = choiceNodes(anchor, "input[type='radio'], [role='radio']");
    if (!radios.length) return { ok: false, reason: "Options disappeared" };
    const match = Match().bestTextMatch(value, radios.map((radio) => ({
      text: optionLabel(radio),
      value: radio.value || "",
      el: radio
    })));
    if (!match && truthy(value) === true && radios.length === 1) {
      setChecked(radios[0], true);
      flash(radios[0]);
      return { ok: true, value: optionLabel(radios[0]) };
    }
    if (!match && truthy(value) === false) return { ok: true, unchanged: true };
    if (!match) return { ok: false, reason: "No matching option" };
    setChecked(match.item.el, true);
    flash(match.item.el);
    return { ok: true, value: optionLabel(match.item.el) };
  }

  function openCombo(el) {
    const host = el.closest?.(".select__control, .select2-selection, [data-automation-id='selectWidget']") || el;
    const arrow = host.querySelector?.(".select__dropdown-indicator, .select2-selection__arrow, [data-automation-id='promptIcon']");
    Dom().clickLikeUser(arrow || host);
  }

  function findOpenListbox(control) {
    for (const attr of ["aria-controls", "aria-owns"]) {
      const id = control.getAttribute(attr);
      const node = id ? control.getRootNode()?.getElementById?.(id) || document.getElementById(id) : null;
      if (node && Dom().isVisible(node)) return node;
    }
    const lists = Dom().queryAllDeep("[role='listbox'], [data-automation-id='promptList'], [data-automation-id='activeListContainer'], .select__menu, .select2-results__options");
    const visible = lists.filter((node) => Dom().isVisible(node));
    return visible.length ? visible[visible.length - 1] : null;
  }

  function optionElements(list) {
    if (!list) return [];
    let nodes = [...list.querySelectorAll("[role='option'], [data-automation-id='promptOption']")];
    if (!nodes.length) nodes = [...list.querySelectorAll("[role='menuitem'], li")];
    return nodes.filter((node) => {
      if (node.getAttribute("aria-disabled") === "true") return false;
      const text = Dom().cleanText(node.textContent);
      return text && text.length < 200;
    });
  }

  function findPopupInput(control, list) {
    if (control.matches?.("input, textarea") && Dom().isVisible(control)) return control;
    const inner = control.querySelector?.("input:not([type='hidden']), textarea");
    if (inner && Dom().isVisible(inner)) return inner;
    const parent = list?.parentElement;
    const nearby = parent?.querySelector("input:not([type='hidden']), textarea");
    if (nearby && Dom().isVisible(nearby)) return nearby;
    const searches = Dom().queryAllDeep("input[data-automation-id='searchBox']").filter((node) => Dom().isVisible(node));
    return searches.length ? searches[searches.length - 1] : null;
  }

  function pickOption(list, want) {
    let nodes = optionElements(list);
    if (!nodes.length) {
      nodes = Dom().queryAllDeep("[role='option'], [data-automation-id='promptOption']").filter((node) => Dom().isVisible(node));
    }
    const match = Match().bestTextMatch(want, nodes.map((node) => ({
      text: Dom().cleanText(node.textContent),
      value: node.getAttribute("data-value") || "",
      el: node
    })));
    return match?.item.el || null;
  }

  async function fillCustomSelect(el, value) {
    const wants = (Array.isArray(value) ? value : [value]).map((item) => String(item)).slice(0, 8);
    const multiple = el.dataset.fillerMultiple === "true" || el.getAttribute("aria-multiselectable") === "true";
    const chosen = [];
    const missed = [];
    for (const want of wants) {
      Dom().scrollIntoView(el);
      el.focus?.();
      openCombo(el);
      let list = await Dom().waitFor(() => findOpenListbox(el), 900);
      const search = findPopupInput(el, list);
      if (search && Dom().cleanText(search.value) !== want) {
        Dom().setNativeValue(search, want);
        list = await Dom().waitFor(() => findOpenListbox(el), 900) || list;
      }
      const option = pickOption(list, want);
      if (!option) {
        missed.push(want);
        Dom().pressEscape();
        continue;
      }
      Dom().clickLikeUser(option);
      chosen.push(Dom().cleanText(option.textContent));
      await Dom().sleep(80);
      if (!multiple) break;
    }
    Dom().pressEscape();
    if (!chosen.length) {
      if (!multiple && el.matches?.("input, textarea")) {
        Dom().setNativeValue(el, wants[0]);
        flash(el);
        return { ok: true, value: wants[0] };
      }
      return { ok: false, reason: `No matching option for "${clip(missed[0] || wants[0])}"` };
    }
    flash(el);
    return { ok: true, value: chosen.join(", ") };
  }

  async function applyOne(anchor, value) {
    const kind = anchor.dataset.fillerKind || "text";
    if (value == null || value === "") return { ok: true, unchanged: true };
    if (typeof value === "string" && value.length > 5000) return { ok: false, reason: "Answer was too long" };
    if (kind === "textarea" || kind === "text") {
      if (anchor.matches?.("[contenteditable='true']") || anchor.getAttribute("role") === "textbox" && !anchor.matches("input, textarea")) {
        return fillContentEditable(anchor, value);
      }
      return fillText(anchor, value);
    }
    if (kind === "select") return fillSelect(anchor, value);
    if (kind === "checkbox") return fillCheckbox(anchor, value);
    if (kind === "checkbox-group") return fillCheckboxGroup(anchor, value);
    if (kind === "radio-group") return fillRadioGroup(anchor, value);
    if (kind === "custom-select") return fillCustomSelect(anchor, value);
    if (kind === "contenteditable") return fillContentEditable(anchor, value);
    if (kind === "spinbutton") return fillSpinbutton(anchor, value);
    return { ok: false, reason: "Unsupported field" };
  }

  function showToast(message) {
    const existing = document.querySelector("[data-filler-toast]");
    existing?.remove();
    const host = document.createElement("div");
    host.setAttribute("data-filler-toast", "");
    host.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:280px;padding:12px 14px;background:#1c1917;color:#f4f0e6;font:13px/1.4 Avenir Next,Segoe UI,sans-serif;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25)";
    host.textContent = message;
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 4200);
  }

  async function applyFills(fills) {
    const filled = [];
    const skipped = [];
    for (const fill of fills || []) {
      const anchor = findAnchor(fill.localId);
      if (!anchor) {
        skipped.push({ label: fill.localId, reason: "Field disappeared before it could be filled" });
        continue;
      }
      try {
        const result = await applyOne(anchor, fill.value);
        if (result.unchanged) continue;
        if (result.ok) filled.push({ label: labelOf(anchor), value: clip(result.value ?? fill.value) });
        else skipped.push({ label: labelOf(anchor), reason: result.reason || "Could not fill this field" });
      } catch (error) {
        skipped.push({ label: labelOf(anchor), reason: String(error?.message || error) });
      }
    }
    if (filled.length) showToast(`Filler wrote ${filled.length} field${filled.length === 1 ? "" : "s"}.`);
    return { filled, skipped };
  }

  const NEXT_LABEL = /^(next|continue|proceed|review|next step|save and continue|save & continue)$/i;
  const BAD_LABEL = /(submit|apply|finish|complete application|send|pay|purchase|donate|sign in|log in|login|register|create account)/i;

  function buttonLabel(el) {
    const value = el.getAttribute("value") || "";
    const aria = el.getAttribute("aria-label") || "";
    return Dom().cleanText(aria || value || el.textContent || "");
  }

  function isNextButton(el) {
    if (!Dom().isVisible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const label = buttonLabel(el);
    if (!label || BAD_LABEL.test(label)) return false;
    const automation = `${el.getAttribute("data-automation-id") || ""} ${el.id || ""}`;
    if (/next/i.test(automation) && !BAD_LABEL.test(label)) return true;
    if (!NEXT_LABEL.test(label)) return false;
    if (el.tagName === "A" && el.href) {
      try {
        const url = new URL(el.href, location.href);
        if (url.origin !== location.origin) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function clickNext() {
    const nodes = Dom().queryAllDeep("button, [role='button'], input[type='button'], input[type='submit'], a");
    const target = nodes.find(isNextButton);
    if (!target) return { clicked: false };
    Dom().scrollIntoView(target);
    Dom().clickLikeUser(target);
    return { clicked: true, label: buttonLabel(target) };
  }

  globalThis.FillerFill = { applyFills, clickNext };
})();
