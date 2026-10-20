(() => {
  "use strict";

  function cleanText(text) {
    return String(text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clip(text, max) {
    const value = cleanText(text);
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
  }

  function cssEscape(value) {
    const text = String(value || "");
    const view = document.defaultView;
    if (view?.CSS?.escape) return view.CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function queryAllDeep(selector, root = document, depth = 0, acc = []) {
    if (!root || depth > 8 || typeof root.querySelectorAll !== "function") return acc;
    root.querySelectorAll(selector).forEach((el) => acc.push(el));
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) queryAllDeep(selector, el.shadowRoot, depth + 1, acc);
    });
    return acc;
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.hidden) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  function naturallyShown(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.hidden) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const root = node.getRootNode?.();
      node = node.parentElement || root?.host || null;
    }
    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(fn, timeout = 1200, interval = 50) {
    const start = Date.now();
    while (true) {
      try {
        const value = fn();
        if (value) return value;
      } catch {
        // The widget may not be in the DOM yet.
      }
      if (Date.now() - start >= timeout) return null;
      await sleep(interval);
    }
  }

  function viewOf(el) {
    return el?.ownerDocument?.defaultView || window;
  }

  function fire(el, type, detail) {
    const view = viewOf(el);
    const bubbles = { bubbles: true, composed: true, cancelable: true };
    let event;
    if (type === "input") {
      const Ctor = view.InputEvent || view.Event;
      try {
        event = new Ctor(type, { ...bubbles, inputType: "insertText", data: detail || "" });
      } catch {
        event = new view.Event(type, bubbles);
      }
    } else if (type === "blur" || type === "focus") {
      const Ctor = view.FocusEvent || view.Event;
      event = new Ctor(type, bubbles);
    } else {
      event = new view.Event(type, bubbles);
    }
    el.dispatchEvent(event);
  }

  function setNativeValue(el, value) {
    const text = value == null ? "" : String(value);
    const view = viewOf(el);
    let proto = view.HTMLInputElement.prototype;
    if (el instanceof view.HTMLTextAreaElement) proto = view.HTMLTextAreaElement.prototype;
    else if (el instanceof view.HTMLSelectElement) proto = view.HTMLSelectElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const previous = descriptor?.get ? descriptor.get.call(el) : el.value;
    if (descriptor?.set) descriptor.set.call(el, text);
    else el.value = text;
    // React stores a value tracker on the instance. It is only visible in the
    // page world, which is why this helper is injected into MAIN.
    const tracker = el._valueTracker;
    if (tracker && typeof tracker.setValue === "function") tracker.setValue(previous);
    if (el instanceof view.HTMLSelectElement) {
      fire(el, "input");
      fire(el, "change");
    } else {
      fire(el, "input", text);
      fire(el, "change");
    }
  }

  function blurField(el) {
    const view = viewOf(el);
    const Focus = view.FocusEvent || view.Event;
    try {
      el.dispatchEvent(new Focus("focusout", { bubbles: true, composed: true }));
    } catch {
      // A page without FocusEvent still gets the blur below.
    }
    if (el.ownerDocument.activeElement === el) {
      try {
        el.blur();
        return;
      } catch {
        // Fall through to a synthetic blur.
      }
    }
    fire(el, "blur");
  }

  function clickLikeUser(el) {
    const view = viewOf(el);
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      clientX: rect.left + Math.min(rect.width / 2, 8),
      clientY: rect.top + Math.min(rect.height / 2, 8)
    };
    const sequence = [
      ["pointerdown", "PointerEvent"],
      ["mousedown", "MouseEvent"],
      ["pointerup", "PointerEvent"],
      ["mouseup", "MouseEvent"]
    ];
    for (const [type, ctorName] of sequence) {
      const Ctor = view[ctorName] || view.MouseEvent;
      try {
        el.dispatchEvent(new Ctor(type, base));
      } catch {
        el.dispatchEvent(new view.MouseEvent(type.replace("pointer", "mouse"), base));
      }
    }
    if (typeof el.click === "function") el.click();
  }

  function scrollIntoView(el) {
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        // Some widgets refuse programmatic scrolling.
      }
    }
  }

  function pressEscape() {
    const view = document.defaultView;
    const target = document.activeElement || document.body;
    if (!target || !view.KeyboardEvent) return;
    target.dispatchEvent(new view.KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      composed: true
    }));
  }

  globalThis.FillerDom = {
    cleanText,
    clip,
    cssEscape,
    queryAllDeep,
    isVisible,
    naturallyShown,
    sleep,
    waitFor,
    fire,
    setNativeValue,
    blurField,
    clickLikeUser,
    scrollIntoView,
    pressEscape
  };
})();
