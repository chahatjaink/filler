(() => {
  "use strict";

  const Dom = () => globalThis.FillerDom;

  const CONTAINER_SELECTOR = [
    "[data-automation-id^='formField']",
    ".application-question",
    ".application-field",
    "[class*='form-field']",
    "[class*='FormField']",
    ".form-group",
    ".field"
  ].join(", ");

  const CUSTOM_SELECTOR = [
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[data-automation-id='selectWidget']",
    ".select__control",
    ".select2-selection"
  ].join(", ");

  const AUTO_LABELS = {
    email: "Email",
    tel: "Phone",
    "given-name": "First name",
    "family-name": "Last name",
    "additional-name": "Middle name",
    name: "Full name",
    organization: "Company",
    "street-address": "Address",
    "address-line1": "Address line 1",
    "address-line2": "Address line 2",
    "address-level2": "City",
    "address-level1": "State",
    "postal-code": "Postal code",
    country: "Country",
    "country-name": "Country",
    bday: "Birthday",
    url: "Website"
  };

  const GENERIC = /^(select|select one|please select|choose|choose one|none|n\/a|enter|type here|search|undefined|--)$/i;
  const TRAP = /leave (this )?(field )?blank|do not fill|honeypot/i;
  const SENSITIVE_AUTO = /^(current-password|new-password|one-time-code|cc-|credit-card)/;

  function elementText(el) {
    if (!el || el.matches?.("input, textarea, select")) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.("input, textarea, select, button, script, style").forEach((node) => node.remove());
    return Dom().cleanText(clone.textContent);
  }

  function labelledByText(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    if (!ids.length) return "";
    const root = el.getRootNode();
    const parts = ids.map((id) => {
      const node = root.getElementById ? root.getElementById(id) : null;
      return elementText(node);
    }).filter(Boolean);
    return parts.join(" ");
  }

  function meaningful(text) {
    const value = Dom().cleanText(text);
    if (!value || GENERIC.test(value)) return "";
    return value;
  }

  function humanize(name) {
    const raw = String(name || "");
    if (!raw || /^(input|field|ctl|id)?[-_]?\d+$/i.test(raw) || /^[a-f0-9-]{16,}$/i.test(raw)) return "";
    return Dom().cleanText(raw.replace(/[_\-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  function autoLabel(autocomplete) {
    if (!autocomplete) return "";
    const token = autocomplete.trim().toLowerCase().split(/\s+/).pop();
    return AUTO_LABELS[token] || "";
  }

  function fieldContainer(el) {
    return el.closest?.(CONTAINER_SELECTOR) || null;
  }

  function containerLabel(el) {
    const container = fieldContainer(el);
    if (!container || container === el) return "";
    const labels = [...container.querySelectorAll("label, legend, [data-automation-id='formLabel'], .application-label, .field-label")];
    const own = labels.find((label) => (el.id && label.getAttribute("for") === el.id) || label.contains(el));
    if (own) return elementText(own);
    if (labels.length === 1) return elementText(labels[0]);
    const legend = [...container.children].find((child) => child.tagName === "LEGEND");
    return legend ? elementText(legend) : "";
  }

  function labelForId(el) {
    if (!el.id) return "";
    const selector = `label[for="${Dom().cssEscape(el.id)}"]`;
    try {
      const root = el.getRootNode();
      const node = root.querySelector?.(selector) || el.ownerDocument.querySelector(selector);
      return elementText(node);
    } catch {
      return "";
    }
  }

  function labelFor(el) {
    const fromFor = labelForId(el);
    const candidates = [
      labelledByText(el),
      meaningful(el.getAttribute("aria-label") || ""),
      fromFor,
      elementText(el.closest?.("label")),
      containerLabel(el),
      meaningful(el.getAttribute("placeholder") || ""),
      autoLabel(el.getAttribute("autocomplete") || ""),
      humanize(el.getAttribute("name") || ""),
      humanize(el.id || "")
    ];
    for (const candidate of candidates) {
      const text = Dom().clip(candidate, 180);
      if (text) return text;
    }
    return "Unlabeled field";
  }

  function nearestHeading(el) {
    let node = el;
    while (node && node !== document.body) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName || "")) return Dom().clip(sibling.textContent, 160);
        sibling = sibling.previousElementSibling;
      }
      const root = node.getRootNode?.();
      node = node.parentElement || root?.host || null;
    }
    return "";
  }

  function helpText(el) {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    const root = el.getRootNode();
    const described = ids.map((id) => elementText(root.getElementById?.(id))).filter(Boolean).join(" ");
    if (described) return Dom().clip(described, 240);
    const container = fieldContainer(el);
    const hint = container?.querySelector("[data-automation-id='formFieldHint'], .helper-text, .help-text, .field-hint");
    return hint ? Dom().clip(hint.textContent, 240) : "";
  }

  function contextFor(el, label) {
    const parts = [nearestHeading(el), helpText(el)].map((part) => Dom().cleanText(part)).filter(Boolean);
    const unique = parts.filter((part) => part.toLowerCase() !== label.toLowerCase());
    return Dom().clip(unique.join(" — "), 280);
  }

  const ERROR_SELECTOR = [
    "[role='alert']",
    "[data-automation-id='errorMessage']",
    "[data-automation-id*='error' i]",
    ".error-message",
    ".field-error",
    ".invalid-feedback",
    ".validation-error",
    ".form-error",
    "[id$='-error']",
    "[id$='_error']"
  ].join(", ");

  function markedInvalid(el) {
    if (!el?.getAttribute) return false;
    if (el.getAttribute("aria-invalid") === "true") return true;
    const container = fieldContainer(el);
    if (container?.getAttribute("aria-invalid") === "true") return true;
    const group = el.closest?.("[role='radiogroup'], [role='group'], fieldset");
    return group?.getAttribute("aria-invalid") === "true";
  }

  function visibleErrorText(node) {
    if (!node || !Dom().isVisible(node)) return "";
    return Dom().clip(elementText(node) || node.textContent, 200);
  }

  function validationError(el) {
    if (!el?.getAttribute) return "";
    const invalid = markedInvalid(el);
    const messages = [];
    const ids = `${el.getAttribute("aria-errormessage") || ""}`.split(/\s+/).filter(Boolean);
    const described = `${el.getAttribute("aria-describedby") || ""}`.split(/\s+/).filter(Boolean);
    const root = el.getRootNode();
    for (const id of ids) {
      const text = visibleErrorText(root.getElementById?.(id));
      if (text) messages.push(text);
    }
    if (invalid) {
      for (const id of described) {
        const text = visibleErrorText(root.getElementById?.(id));
        if (text) messages.push(text);
      }
    }
    const hosts = [el, fieldContainer(el), el.parentElement].filter(Boolean);
    for (const host of hosts) {
      if (host.matches?.(ERROR_SELECTOR)) {
        const text = visibleErrorText(host);
        if (text) messages.push(text);
      }
      host.querySelectorAll?.(ERROR_SELECTOR).forEach((node) => {
        if (node === el || node.contains?.(el)) return;
        const text = visibleErrorText(node);
        if (text) messages.push(text);
      });
    }
    const hasValue = Boolean(Dom().cleanText(el.value || ""));
    if (hasValue && el.matches?.(":invalid") && el.validationMessage) messages.push(el.validationMessage);
    if (!invalid && !messages.length) return "";
    const unique = [...new Set(messages.map((item) => Dom().cleanText(item)).filter(Boolean))];
    if (unique.length) return Dom().clip(unique.join(" "), 240);
    return invalid ? "This field was rejected." : "";
  }

  function lengthLimit(el, name) {
    const raw = el.getAttribute?.(name) || el.getAttribute?.(`data-${name}`) || "";
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function isRequired(el, label) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    if (/\*\s*$/.test(label)) return true;
    const container = fieldContainer(el) || el.parentElement;
    return Boolean(container?.querySelector("abbr[title*='required' i], [data-automation-id='required'], [aria-label*='required' i]"));
  }

  function isOffscreenTrap(el) {
    const style = getComputedStyle(el);
    if (style.position !== "absolute" && style.position !== "fixed") return false;
    if (parseFloat(style.left) < -200 || parseFloat(style.top) < -200) return true;
    const rect = el.getBoundingClientRect();
    return rect.left < -200 || rect.top < -200;
  }

  function claimTree(el, claimed) {
    claimed.add(el);
    Dom().queryAllDeep("input, textarea, select, button", el).forEach((node) => claimed.add(node));
  }

  function isCustomSelect(el) {
    if (!(el instanceof Element) || el.matches("select, textarea")) return false;
    const role = el.getAttribute("role");
    const popup = el.getAttribute("aria-haspopup");
    const widget = role === "combobox"
      || popup === "listbox"
      || el.getAttribute("data-automation-id") === "selectWidget"
      || el.classList.contains("select__control")
      || el.classList.contains("select2-selection");
    if (!widget) return false;
    if (el.matches("input") && role !== "combobox" && popup !== "listbox") return false;
    const inputs = Dom().queryAllDeep("input:not([type='hidden']), textarea, select", el);
    return inputs.length <= 2;
  }

  function optionLabels(nodes) {
    const labels = [];
    for (const node of nodes) {
      const text = meaningful(node.textContent || "");
      if (text && text.length < 160) labels.push(text);
    }
    return [...new Set(labels)].slice(0, 40);
  }

  function customOptions(el) {
    const roots = [];
    for (const attr of ["aria-controls", "aria-owns"]) {
      const id = el.getAttribute(attr);
      const root = id ? el.getRootNode()?.getElementById?.(id) : null;
      if (root) roots.push(root);
    }
    const inner = el.querySelector?.("[role='listbox']");
    if (inner) roots.push(inner);
    const nodes = [];
    for (const root of roots) {
      root.querySelectorAll("[role='option'], [data-automation-id='promptOption']").forEach((node) => nodes.push(node));
    }
    return optionLabels(nodes);
  }

  function selectOptions(el) {
    return optionLabels([...el.options || []]);
  }

  function indexElements(root) {
    const map = new Map();
    let index = 0;
    const walk = (node) => {
      if (!node || node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
      if (node.nodeType === 1) {
        map.set(node, index);
        index += 1;
        if (node.shadowRoot) walk(node.shadowRoot);
      }
      const children = node.children || node.childNodes;
      if (!children) return;
      for (const child of children) {
        if (child.nodeType === 1) walk(child);
      }
    };
    walk(root.body || root);
    return map;
  }

  function currentControlValue(el, kind) {
    if (kind === "checkbox" || (el.matches?.("input[type='checkbox']"))) {
      return el.checked ? "yes" : "";
    }
    if (el.matches?.("select")) {
      const selected = [...el.selectedOptions || []].map((option) => Dom().cleanText(option.textContent)).filter(Boolean);
      return selected.join(", ");
    }
    if (el.matches?.("[role='checkbox'], [role='radio']")) {
      return el.getAttribute("aria-checked") === "true" ? "yes" : "";
    }
    const raw = el.matches?.("input, textarea") ? el.value : el.textContent;
    return meaningful(raw || "");
  }

  function describe(el, kind, order) {
    const label = labelFor(el);
    const inputType = (el.getAttribute("type") || kind).toLowerCase();
    const options = kind === "select" ? selectOptions(el) : kind === "custom-select" ? customOptions(el) : [];
    const multiple = Boolean(el.multiple)
      || el.getAttribute("aria-multiselectable") === "true"
      || /multi/i.test(`${el.getAttribute("data-automation-id") || ""} ${fieldContainer(el)?.getAttribute("data-automation-id") || ""}`);
    return {
      element: el,
      kind,
      order,
      inputType,
      name: el.getAttribute("name") || "",
      label,
      optionLabel: label,
      required: isRequired(el, label),
      placeholder: meaningful(el.getAttribute("placeholder") || ""),
      autocomplete: el.getAttribute("autocomplete") || "",
      currentValue: currentControlValue(el, kind),
      options,
      context: contextFor(el, label),
      multiple,
      searchable: kind === "custom-select" || options.length === 0 || options.length >= 40,
      maxLength: lengthLimit(el, "maxlength"),
      minLength: lengthLimit(el, "minlength"),
      error: validationError(el)
    };
  }

  function groupAnchor(list) {
    const first = list[0].element;
    const group = first.closest("[role='radiogroup'], [role='group'], fieldset");
    if (group && list.every((item) => group.contains(item.element))) return group;
    return first;
  }

  function questionLabel(anchor, list) {
    const legend = [...(anchor.children || [])].find((child) => child.tagName === "LEGEND");
    if (legend) return elementText(legend);
    const aria = meaningful(anchor.getAttribute?.("aria-label") || "");
    if (aria) return aria;
    const labelled = labelledByText(anchor);
    if (labelled) return labelled;
    const optionLabels = new Set(list.map((item) => Dom().cleanText(item.optionLabel).toLowerCase()));
    const container = fieldContainer(anchor) || anchor.parentElement;
    const text = container ? containerLabel(list[0].element) || elementText([...container.querySelectorAll("legend, [data-automation-id='formLabel']")][0]) : "";
    if (text && !optionLabels.has(Dom().cleanText(text).toLowerCase())) return text;
    return "";
  }

  function choiceGroup(list, kind) {
    const anchor = groupAnchor(list);
    const question = questionLabel(anchor, list) || list[0].label;
    const selected = list
      .filter((item) => item.element.checked || item.element.getAttribute("aria-checked") === "true")
      .map((item) => item.optionLabel);
    return {
      anchor,
      kind,
      order: Math.min(...list.map((item) => item.order)),
      label: question,
      required: list.some((item) => item.required),
      groupName: list[0].name || "",
      options: list.map((item) => item.optionLabel).filter(Boolean),
      context: list.map((item) => item.context).find(Boolean) || "",
      multiple: kind === "checkbox-group",
      inputType: kind,
      currentValue: selected.join(", "),
      placeholder: "",
      autocomplete: "",
      searchable: false,
      maxLength: 0,
      minLength: 0,
      error: validationError(anchor) || list.map((item) => validationError(item.element)).find(Boolean) || "",
      element: anchor
    };
  }

  function singleField(control) {
    return { ...control, anchor: control.element, groupName: "" };
  }

  function radioKey(control) {
    if (control.name) return `name:${control.name}`;
    const group = control.element.closest("[role='radiogroup'], [role='group']");
    if (group) {
      if (!group.dataset.fillerGroup) group.dataset.fillerGroup = `g${control.order}`;
      return `group:${group.dataset.fillerGroup}`;
    }
    const fieldset = control.element.closest("fieldset");
    if (fieldset && !fieldset.querySelector("input:not([type='radio']):not([type='hidden']), textarea, select")) {
      if (!fieldset.dataset.fillerGroup) fieldset.dataset.fillerGroup = `g${control.order}`;
      return `group:${fieldset.dataset.fillerGroup}`;
    }
    return `solo:${control.order}`;
  }

  function groupControls(controls) {
    const radios = new Map();
    const checks = new Map();
    const rest = [];
    for (const control of controls) {
      if (control.kind === "radio") {
        const key = radioKey(control);
        if (!radios.has(key)) radios.set(key, []);
        radios.get(key).push(control);
      } else if (control.kind === "checkbox" && control.name) {
        const key = `name:${control.name}`;
        if (!checks.has(key)) checks.set(key, []);
        checks.get(key).push(control);
      } else {
        rest.push(singleField(control));
      }
    }
    const fields = [...rest];
    for (const list of radios.values()) fields.push(choiceGroup(list, "radio-group"));
    for (const list of checks.values()) {
      fields.push(list.length > 1 ? choiceGroup(list, "checkbox-group") : singleField(list[0]));
    }
    fields.sort((a, b) => a.order - b.order);
    return fields;
  }

  function nativeKind(el, type) {
    if (el.tagName === "SELECT") return "select";
    if (el.tagName === "TEXTAREA") return "textarea";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "text";
  }

  function shouldSkipNative(el, type) {
    if (["password", "hidden", "submit", "button", "reset", "image", "color", "range"].includes(type)) return true;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return true;
    if (SENSITIVE_AUTO.test((el.getAttribute("autocomplete") || "").toLowerCase())) return true;
    if ((type === "text" || el.tagName === "TEXTAREA") && el.readOnly && el.value) return true;
    if (isOffscreenTrap(el)) return true;
    return false;
  }

  function hiddenSelectFallback(el) {
    if (el.tagName !== "SELECT" || !el.options?.length) return false;
    const container = fieldContainer(el) || el.parentElement;
    if (!container) return true;
    const widgets = Dom().queryAllDeep(CUSTOM_SELECTOR, container).filter((node) => Dom().isVisible(node));
    return widgets.length === 0;
  }

  function useful(control) {
    if (TRAP.test(control.label)) return false;
    if (control.label !== "Unlabeled field") return true;
    return Boolean(control.placeholder || control.autocomplete || control.options.length || control.name);
  }

  function toPublic(field, localId) {
    const anchor = field.anchor;
    anchor.dataset.fillerId = localId;
    anchor.dataset.fillerKind = field.kind;
    anchor.dataset.fillerLabel = Dom().clip(field.label, 180);
    if (field.groupName) anchor.dataset.fillerName = field.groupName;
    else delete anchor.dataset.fillerName;
    if (field.multiple) anchor.dataset.fillerMultiple = "true";
    else delete anchor.dataset.fillerMultiple;

    const pub = {
      localId,
      kind: field.kind,
      label: Dom().clip(field.label, 180),
      required: Boolean(field.required)
    };
    if (field.inputType) pub.inputType = field.inputType;
    if (field.placeholder) pub.placeholder = field.placeholder;
    if (field.autocomplete) pub.autocomplete = field.autocomplete;
    if (field.currentValue) pub.currentValue = Dom().clip(field.currentValue, 180);
    if (field.context) pub.context = field.context;
    if (field.maxLength) pub.maxLength = field.maxLength;
    if (field.minLength) pub.minLength = field.minLength;
    if (field.error) pub.error = field.error;
    if (field.multiple) pub.multiple = true;
    if (field.searchable) pub.searchable = true;
    if (field.options?.length) pub.options = field.options.slice(0, 40);
    return pub;
  }

  function ariaKind(el) {
    const role = el.getAttribute("role");
    if (role === "checkbox") return "checkbox";
    if (role === "radio") return "radio";
    if (role === "spinbutton") return "spinbutton";
    if (el.getAttribute("contenteditable") === "true" || el.isContentEditable) return "contenteditable";
    return "text";
  }

  function extractFormUnsafe() {
    const order = indexElements(document);
    const claimed = new Set();
    const controls = [];
    const manual = [];

    for (const el of Dom().queryAllDeep(CUSTOM_SELECTOR)) {
      if (claimed.has(el) || !isCustomSelect(el) || !Dom().isVisible(el)) continue;
      claimTree(el, claimed);
      const control = describe(el, "custom-select", order.get(el) ?? controls.length);
      if (useful(control)) controls.push(control);
    }

    for (const el of Dom().queryAllDeep("input, textarea, select")) {
      if (claimed.has(el)) continue;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "file") {
        manual.push({
          label: labelFor(el) || "File upload",
          reason: "Choose this file yourself. Browsers block extensions from attaching files."
        });
        claimed.add(el);
        continue;
      }
      if (shouldSkipNative(el, type)) continue;
      const available = Dom().naturallyShown(el) || hiddenSelectFallback(el);
      if (!available) continue;
      if (el.matches("select") && el.getAttribute("aria-hidden") === "true" && !hiddenSelectFallback(el)) continue;
      claimed.add(el);
      const control = describe(el, nativeKind(el, type), order.get(el) ?? controls.length);
      if (useful(control)) controls.push(control);
    }

    for (const el of Dom().queryAllDeep("[role='checkbox'], [role='radio'], [role='spinbutton'], [role='textbox'], [contenteditable='true']")) {
      if (claimed.has(el) || el === document.body || el === document.documentElement) continue;
      if (el.getAttribute("contenteditable") === "true" && el.parentElement?.closest("[contenteditable='true']")) continue;
      if (!Dom().isVisible(el) || el.getAttribute("aria-disabled") === "true" || isOffscreenTrap(el)) continue;
      claimed.add(el);
      const control = describe(el, ariaKind(el), order.get(el) ?? controls.length);
      if (useful(control)) controls.push(control);
    }

    const fields = groupControls(controls);
    let seq = globalThis.__FILLER_SEQ__ || 1;
    const publicFields = [];
    for (const field of fields) {
      const localId = field.anchor.dataset.fillerId || `f${(seq).toString(36)}`;
      seq += 1;
      publicFields.push(toPublic(field, localId));
    }
    globalThis.__FILLER_SEQ__ = seq;
    return {
      fields: publicFields,
      manual,
      title: document.title || "",
      url: location.href,
      lang: document.documentElement.lang || ""
    };
  }

  function blockSkip(node, removeForms) {
    if (node.nodeType !== 1) return false;
    const tag = node.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "IFRAME", "NAV", "FOOTER", "HEADER"].includes(tag)) return true;
    if (removeForms && tag === "FORM") return true;
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
    const marker = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`;
    return /cookie|consent|onetrust|gdpr/i.test(marker);
  }

  function collectText(node, removeForms, acc) {
    if (!node) return;
    if (node.nodeType === 3) {
      const text = node.textContent || "";
      if (text.trim()) acc.push(text);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
    if (node.nodeType === 1 && blockSkip(node, removeForms)) return;
    if (node.shadowRoot) collectText(node.shadowRoot, removeForms, acc);
    const block = node.nodeType === 1 && /^(P|DIV|LI|H1|H2|H3|H4|H5|H6|SECTION|ARTICLE|TR|BLOCKQUOTE|BR)$/.test(node.tagName);
    for (const child of node.childNodes) collectText(child, removeForms, acc);
    if (block) acc.push("\n");
  }

  function textFrom(root, removeForms) {
    const acc = [];
    collectText(root, removeForms, acc);
    return acc.join(" ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  }

  function extractPageText() {
    const main = document.querySelector("article, main, [role='main']");
    let text = main ? textFrom(main, true) : "";
    if (text.length < 120) text = textFrom(document.body, true);
    if (text.length < 120) text = textFrom(main || document.body, false);
    return {
      title: document.title || "",
      url: location.href,
      text: text.slice(0, 14000)
    };
  }

  function extractForm() {
    try {
      return extractFormUnsafe();
    } catch (error) {
      return {
        fields: [],
        manual: [],
        title: document.title || "",
        url: location.href,
        lang: document.documentElement?.lang || "",
        error: String(error?.message || error)
      };
    }
  }

  globalThis.FillerExtract = { extractForm, extractPageText };
})();
