(function () {
  // Guard against double injection
  if (window.__devstyleLoaded) return;
  window.__devstyleLoaded = true;

  let mode = "none"; // "none" | "element" | "font" | "html" | "tailwind" | "sandbox"
  let tooltip = null;
  let currentEl = null;
  let prevOutline = "";
  let prevCursor = "";
  let lastCSS = "";
  let stopTimer = null;
  let devicePreview = null;
  let tailwindVersion = "v4";

  const DEVICE_VIEWS = {
    mobile: { label: "Mobile", width: 390, height: 844 },
    tablet: { label: "Tablet", width: 768, height: 1024 },
    desktop: { label: "Desktop", width: 1440, height: 900 }
  };

  // ---------------------------------------------------------------------------
  // Element mode: curated computed properties. Defaults are skipped so the
  // output stays clean and ready to paste into a stylesheet.
  // ---------------------------------------------------------------------------

  const CURATED = [
    "display", "position", "top", "right", "bottom", "left", "z-index",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "box-sizing",
    "flex-direction", "flex-wrap", "justify-content", "align-items", "gap",
    "grid-template-columns", "grid-template-rows",
    "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-align", "text-transform", "white-space",
    "color", "background-color", "background-image", "background-size",
    "border-radius", "box-shadow",
    "opacity", "overflow-x", "overflow-y", "transform", "transition"
  ];

  const SKIP_VALUES = {
    "position": ["static"],
    "top": ["auto"], "right": ["auto"], "bottom": ["auto"], "left": ["auto"],
    "z-index": ["auto"],
    "min-width": ["0px"], "min-height": ["0px"],
    "max-width": ["none"], "max-height": ["none"],
    "flex-direction": ["row"], "flex-wrap": ["nowrap"],
    "justify-content": ["normal"], "align-items": ["normal"], "gap": ["normal"],
    "grid-template-columns": ["none"], "grid-template-rows": ["none"],
    "font-style": ["normal"],
    "letter-spacing": ["normal"],
    "text-align": ["start"],
    "text-transform": ["none"],
    "white-space": ["normal"],
    "background-color": ["rgba(0, 0, 0, 0)", "transparent"],
    "background-image": ["none"],
    "background-size": ["auto"],
    "border-radius": ["0px"],
    "box-shadow": ["none"],
    "opacity": ["1"],
    "overflow-x": ["visible"], "overflow-y": ["visible"],
    "transform": ["none"]
  };

  const FLEX_CONTAINER_PROPS = ["flex-direction", "flex-wrap", "justify-content", "align-items"];

  // ---------------------------------------------------------------------------
  // Typography mode: only text-related properties
  // ---------------------------------------------------------------------------

  const FONT_PROPS = [
    "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "word-spacing", "text-transform", "text-align",
    "text-decoration-line", "text-shadow", "white-space", "color"
  ];

  // These are always included even when at their default — they are the core
  // of any typography spec
  const FONT_ALWAYS = ["font-family", "font-size", "font-weight", "line-height", "color"];

  const FONT_SKIP = {
    "font-style": ["normal"],
    "letter-spacing": ["normal"],
    "word-spacing": ["normal", "0px"],
    "text-transform": ["none"],
    "text-align": ["start"],
    "text-decoration-line": ["none"],
    "text-shadow": ["none"],
    "white-space": ["normal"]
  };

  function escapeSelector(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    // Chrome supports CSS.escape, but keep selectors valid in older Chromium builds too.
    return String(value).replace(/(^-?\d)|^-$|[^a-zA-Z0-9_-]/g, match =>
      [...match].map(char => "\\" + char.codePointAt(0).toString(16) + " ").join("")
    );
  }

  function selectorFor(el) {
    if (el.id) return "#" + escapeSelector(el.id);
    const classes = [...el.classList]
      .filter(c => typeof c === "string" && c.trim())
      .slice(0, 3)
      .map(escapeSelector);
    if (classes.length) return el.tagName.toLowerCase() + "." + classes.join(".");
    return el.tagName.toLowerCase();
  }

  function buildFontCSS(el) {
    const cs = getComputedStyle(el);
    const lines = [];

    for (const prop of FONT_PROPS) {
      const val = cs[prop];
      if (!val) continue;
      if (!FONT_ALWAYS.includes(prop) && FONT_SKIP[prop] && FONT_SKIP[prop].includes(val)) continue;
      const name = prop === "text-decoration-line" ? "text-decoration" : prop;
      lines.push(name + ": " + val);
    }

    return selectorFor(el) + " {\n  " + lines.join(";\n  ") + ";\n}";
  }

  function buildHTML(el) {
    return el.outerHTML;
  }

  const JSX_ATTRIBUTE_NAMES = {
    "class": "className",
    "for": "htmlFor",
    "tabindex": "tabIndex",
    "readonly": "readOnly",
    "maxlength": "maxLength",
    "minlength": "minLength",
    "colspan": "colSpan",
    "rowspan": "rowSpan",
    "cellpadding": "cellPadding",
    "cellspacing": "cellSpacing",
    "contenteditable": "contentEditable",
    "autocomplete": "autoComplete"
  };
  const JSX_BOOLEAN_ATTRIBUTES = new Set(["checked", "disabled", "hidden", "multiple", "required", "selected", "readOnly"]);
  const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

  function prepareSandboxElement(source, clone) {
    const sourceElements = [source, ...source.querySelectorAll("*")];
    const cloneElements = [clone, ...clone.querySelectorAll("*")];

    sourceElements.forEach((sourceElement, index) => {
      const cloneElement = cloneElements[index];
      if (!cloneElement) return;

      // The sandbox owns styling through generated utilities, not page-specific
      // class names or inline declarations that would not exist in a new app.
      cloneElement.setAttribute("class", buildTailwind(sourceElement));
      cloneElement.removeAttribute("style");
      [...cloneElement.attributes].forEach(attribute => {
        if (/^on/i.test(attribute.name)) cloneElement.removeAttribute(attribute.name);
      });
      if (["script", "style", "link", "meta", "noscript"].includes(cloneElement.tagName.toLowerCase())) {
        cloneElement.remove();
      }
    });
  }

  function jsxAttribute(attribute) {
    const name = JSX_ATTRIBUTE_NAMES[attribute.name.toLowerCase()] || attribute.name;
    if (JSX_BOOLEAN_ATTRIBUTES.has(name) && (attribute.value === "" || attribute.value === attribute.name)) {
      return name;
    }
    return name + "=" + JSON.stringify(attribute.value);
  }

  function serializeSandboxNode(node, depth = 0) {
    const indent = "  ".repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.trim() ? indent + "{" + JSON.stringify(node.nodeValue) + "}" : "";
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      return indent + "{/* " + node.nodeValue.replace(/\*\//g, "* /") + " */}";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const attributes = [...node.attributes].map(jsxAttribute);
    const opening = "<" + tag + (attributes.length ? " " + attributes.join(" ") : "");
    if (VOID_ELEMENTS.has(tag)) return indent + opening + " />";

    const children = [...node.childNodes]
      .map(child => serializeSandboxNode(child, depth + 1))
      .filter(Boolean);
    if (!children.length) return indent + opening + " />";
    return indent + opening + ">\n" + children.join("\n") + "\n" + indent + "</" + tag + ">";
  }

  function buildSandboxExport(el) {
    const componentName = "DevStyleComponent";
    const clone = el.cloneNode(true);
    prepareSandboxElement(el, clone);
    const jsx = serializeSandboxNode(clone, 2);
    return [
      "// " + componentName + ".jsx",
      "// Generated Tailwind utilities capture the selected component's current styling.",
      "",
      "export default function " + componentName + "() {",
      "  return (",
      jsx,
      "  );",
      "}"
    ].join("\n");
  }

  function colorToHex(value) {
    if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return null;
    const match = value.match(/^rgba?\((.+)\)$/i);
    if (!match) return value;

    const channels = match[1].replace("/", " ").split(/[\s,]+/).filter(Boolean);
    if (channels.length < 3) return value;
    const rgb = channels.slice(0, 3).map(Number);
    if (!rgb.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255)) return value;

    const alpha = channels[3] === undefined ? 1 : Number(channels[3]);
    if (!Number.isFinite(alpha) || alpha <= 0) return null;
    const hex = "#" + rgb.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("");
    return alpha >= 1 ? hex : hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
  }

  function buildPagePalette() {
    const counts = new Map();
    const addColor = (value, weight = 1) => {
      const color = colorToHex(value);
      if (color) counts.set(color, (counts.get(color) || 0) + weight);
    };
    const nodes = [document.body, ...document.body.querySelectorAll("*")].slice(0, 2500);

    nodes.forEach(node => {
      const cs = getComputedStyle(node);
      addColor(cs.color);
      addColor(cs["background-color"], 2);
      ["top", "right", "bottom", "left"].forEach(side => {
        if (cs["border-" + side + "-style"] !== "none" && cs["border-" + side + "-width"] !== "0px") {
          addColor(cs["border-" + side + "-color"]);
        }
      });
    });

    const palette = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([color]) => color);
    if (!palette.length) palette.push("#000000", "#ffffff");

    const variables = palette.map((color, index) => "  --devstyle-color-" + (index + 1) + ": " + color + ";");
    const tailwindTheme = tailwindVersion !== "v4"
      ? [
          "module.exports = {",
          "  theme: { extend: { colors: {",
          ...palette.map((color, index) => "    'devstyle-" + (index + 1) + "': '" + color + "',"),
          "  } } },",
          "};"
        ]
      : [
          "@theme {",
          ...palette.map((color, index) => "  --color-devstyle-" + (index + 1) + ": " + color + ";"),
          "}"
        ];

    return [
      "/* Page palette */",
      ":root {",
      ...variables,
      "}",
      "",
      "/* Tailwind CSS " + (tailwindVersion === "v4" ? "v4" : tailwindVersion) + " theme */",
      ...tailwindTheme
    ].join("\n");
  }

  // ---------------------------------------------------------------------------
  // Tailwind mode: translate the same useful computed styles into utility
  // classes. Arbitrary values keep the output faithful when there is no exact
  // Tailwind scale equivalent.
  // ---------------------------------------------------------------------------

  function tailwindValue(value) {
    const color = value.match(/^rgba?\((.+)\)$/i);
    if (color && color[1].includes(",")) {
      const parts = color[1].split(",").map(part => part.trim());
      if (parts.length === 3) value = "rgb(" + parts.join(" ") + ")";
      if (parts.length === 4) value = "rgb(" + parts.slice(0, 3).join(" ") + " / " + parts[3] + ")";
    }
    return value.trim().replace(/\s+/g, "_");
  }

  function tailwindColorValue(value, version) {
    const color = value.match(/^rgba?\((.+)\)$/i);
    if (!color || !color[1].includes(",")) return tailwindValue(value);

    const parts = color[1].split(",").map(part => part.trim());
    if (version !== "v4" && parts.length === 3) {
      const channels = parts.map(Number);
      if (channels.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
        return "#" + channels.map(channel => channel.toString(16).padStart(2, "0")).join("");
      }
    }
    if (version !== "v4") return "rgba(" + parts.join(",") + ")";

    if (parts.length === 3) return tailwindValue("rgb(" + parts.join(" ") + ")");
    if (parts.length === 4) return tailwindValue("rgb(" + parts.slice(0, 3).join(" ") + " / " + parts[3] + ")");
    return tailwindValue(value);
  }

  function twArbitrary(prefix, value) {
    return prefix + "-[" + tailwindValue(value) + "]";
  }

  function twColor(prefix, value, version) {
    return prefix + "-[" + tailwindColorValue(value, version) + "]";
  }

  function addBoxUtilities(classes, prefix, cs) {
    const values = ["top", "right", "bottom", "left"].map(side => cs[prefix + "-" + side]);
    if (values.every(value => value === "0px")) return;
    if (values.every(value => value === values[0])) {
      classes.push(twArbitrary(prefix[0], values[0]));
      return;
    }

    const [top, right, bottom, left] = values;
    const included = new Set();
    if (left === right && left !== "0px") {
      classes.push(twArbitrary(prefix[0] + "x", left));
      included.add(1);
      included.add(3);
    }
    if (top === bottom && top !== "0px") {
      classes.push(twArbitrary(prefix[0] + "y", top));
      included.add(0);
      included.add(2);
    }

    const sides = ["t", "r", "b", "l"];
    values.forEach((value, index) => {
      if (value !== "0px" && !included.has(index)) classes.push(twArbitrary(prefix[0] + sides[index], value));
    });
  }

  function addBorderUtilities(classes, cs, version) {
    const sides = ["top", "right", "bottom", "left"];
    const borders = sides.map(side => ({
      width: cs["border-" + side + "-width"],
      style: cs["border-" + side + "-style"],
      color: cs["border-" + side + "-color"]
    }));
    if (borders.every(border => border.style === "none" || border.width === "0px")) return;

    const uniform = borders.every(border =>
      border.width === borders[0].width && border.style === borders[0].style && border.color === borders[0].color
    );
    const addBorder = (border, side = "") => {
      if (border.style === "none" || border.width === "0px") return;
      const prefix = side ? "border-" + side : "border";
      classes.push(twArbitrary(prefix, border.width));
      if (border.style !== "solid") classes.push(prefix + "-" + border.style);
      classes.push(twColor(prefix, border.color, version));
    };

    if (uniform) addBorder(borders[0]);
    else borders.forEach((border, index) => addBorder(border, ["t", "r", "b", "l"][index]));
  }

  function buildTailwind(el) {
    const cs = getComputedStyle(el);
    const classes = [];
    const displayClasses = {
      "block": "block", "inline": "inline", "inline-block": "inline-block", "flex": "flex",
      "inline-flex": "inline-flex", "grid": "grid", "inline-grid": "inline-grid", "none": "hidden"
    };
    const positionClasses = { relative: "relative", absolute: "absolute", fixed: "fixed", sticky: "sticky" };
    const justifyClasses = {
      "flex-start": "justify-start", "flex-end": "justify-end", center: "justify-center",
      "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly"
    };
    const alignClasses = {
      "flex-start": "items-start", "flex-end": "items-end", center: "items-center",
      stretch: "items-stretch", baseline: "items-baseline"
    };

    if (displayClasses[cs.display]) classes.push(displayClasses[cs.display]);
    if (positionClasses[cs.position]) classes.push(positionClasses[cs.position]);
    ["top", "right", "bottom", "left"].forEach(side => {
      if (cs.position !== "static" && cs[side] !== "auto") classes.push(twArbitrary(side, cs[side]));
    });
    if (cs["z-index"] !== "auto") classes.push(twArbitrary("z", cs["z-index"]));

    const dimensions = [
      ["width", "w"], ["height", "h"], ["min-width", "min-w"], ["min-height", "min-h"],
      ["max-width", "max-w"], ["max-height", "max-h"]
    ];
    dimensions.forEach(([property, prefix]) => {
      const value = cs[property];
      if (value && value !== "auto" && value !== "none") classes.push(twArbitrary(prefix, value));
    });
    if (cs["box-sizing"] === "border-box") classes.push("box-border");
    if (cs["box-sizing"] === "content-box") classes.push("box-content");

    if (cs.display.includes("flex")) {
      const direction = { row: "flex-row", "row-reverse": "flex-row-reverse", column: "flex-col", "column-reverse": "flex-col-reverse" };
      if (direction[cs["flex-direction"]]) classes.push(direction[cs["flex-direction"]]);
      if (cs["flex-wrap"] === "wrap") classes.push("flex-wrap");
      if (cs["flex-wrap"] === "wrap-reverse") classes.push("flex-wrap-reverse");
      if (justifyClasses[cs["justify-content"]]) classes.push(justifyClasses[cs["justify-content"]]);
      if (alignClasses[cs["align-items"]]) classes.push(alignClasses[cs["align-items"]]);
    }
    if (cs.display.includes("grid")) {
      if (cs["grid-template-columns"] !== "none") classes.push(twArbitrary("grid-cols", cs["grid-template-columns"]));
      if (cs["grid-template-rows"] !== "none") classes.push(twArbitrary("grid-rows", cs["grid-template-rows"]));
    }
    if ((cs.display.includes("flex") || cs.display.includes("grid")) && cs.gap !== "normal") {
      classes.push(twArbitrary("gap", cs.gap));
    }

    const fontWeights = {
      "100": "font-thin", "200": "font-extralight", "300": "font-light", "400": "font-normal",
      "500": "font-medium", "600": "font-semibold", "700": "font-bold", "800": "font-extrabold", "900": "font-black"
    };
    const fontSizes = { "12px": "text-xs", "14px": "text-sm", "16px": "text-base", "18px": "text-lg", "20px": "text-xl", "24px": "text-2xl", "30px": "text-3xl", "36px": "text-4xl" };
    const fontFamily = cs["font-family"];
    const normalizedFontFamily = fontFamily.toLowerCase();
    const isSystemSans = ["-apple-system", "blinkmacsystemfont", "segoe ui", "roboto"].every(font =>
      normalizedFontFamily.includes(font)
    );
    const isSystemMono = ["ui-monospace", "sfmono", "consolas"].some(font => normalizedFontFamily.includes(font));
    if (isSystemSans) classes.push("font-sans");
    else if (isSystemMono) classes.push("font-mono");
    else if (fontFamily) classes.push(twArbitrary("font", fontFamily));
    if (fontSizes[cs["font-size"]]) classes.push(fontSizes[cs["font-size"]]);
    else if (cs["font-size"]) classes.push(twArbitrary("text", cs["font-size"]));
    if (fontWeights[cs["font-weight"]]) classes.push(fontWeights[cs["font-weight"]]);
    else if (cs["font-weight"]) classes.push("[font-weight:" + tailwindValue(cs["font-weight"]) + "]");
    if (cs["font-style"] === "italic") classes.push("italic");
    if (cs["line-height"] !== "normal") classes.push(twArbitrary("leading", cs["line-height"]));
    if (cs["letter-spacing"] !== "normal") classes.push(twArbitrary("tracking", cs["letter-spacing"]));
    const textAlign = { left: "text-left", right: "text-right", center: "text-center", justify: "text-justify" };
    if (textAlign[cs["text-align"]]) classes.push(textAlign[cs["text-align"]]);
    const transforms = { uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize" };
    if (transforms[cs["text-transform"]]) classes.push(transforms[cs["text-transform"]]);
    const whitespace = { nowrap: "whitespace-nowrap", pre: "whitespace-pre", "pre-wrap": "whitespace-pre-wrap", "pre-line": "whitespace-pre-line" };
    if (whitespace[cs["white-space"]]) classes.push(whitespace[cs["white-space"]]);
    if (cs.color) classes.push(twColor("text", cs.color, tailwindVersion));

    if (!["rgba(0, 0, 0, 0)", "transparent"].includes(cs["background-color"])) {
      classes.push(twColor("bg", cs["background-color"], tailwindVersion));
    }
    if (cs["background-image"] !== "none") classes.push("[background-image:" + tailwindValue(cs["background-image"]) + "]");
    if (cs["background-size"] !== "auto") classes.push("[background-size:" + tailwindValue(cs["background-size"]) + "]");
    if (cs["border-radius"] !== "0px") classes.push(twArbitrary("rounded", cs["border-radius"]));
    if (cs["box-shadow"] !== "none") classes.push(twArbitrary("shadow", cs["box-shadow"]));
    if (cs.opacity !== "1") classes.push(twArbitrary("opacity", cs.opacity));
    if (cs["overflow-x"] === cs["overflow-y"] && cs["overflow-x"] !== "visible") classes.push("overflow-" + cs["overflow-x"]);
    else {
      if (cs["overflow-x"] !== "visible") classes.push("overflow-x-" + cs["overflow-x"]);
      if (cs["overflow-y"] !== "visible") classes.push("overflow-y-" + cs["overflow-y"]);
    }
    if (cs.transform !== "none") classes.push("[transform:" + tailwindValue(cs.transform) + "]");
    if (cs["transition-duration"].split(",").some(duration => Number.parseFloat(duration) > 0)) {
      classes.push("[transition:" + tailwindValue(cs.transition) + "]");
    }

    addBoxUtilities(classes, "margin", cs);
    addBoxUtilities(classes, "padding", cs);
    addBorderUtilities(classes, cs, tailwindVersion);
    return [...new Set(classes)].join(" ");
  }

  // Collapse margin/padding longhands into a shorthand line, skip if all zero
  function boxLine(name, cs) {
    const t = cs[name + "-top"], r = cs[name + "-right"],
          b = cs[name + "-bottom"], l = cs[name + "-left"];
    if (t === "0px" && r === "0px" && b === "0px" && l === "0px") return null;
    if (t === r && r === b && b === l) return name + ": " + t;
    return name + ": " + t + " " + r + " " + b + " " + l;
  }

  // Uniform borders -> one shorthand line; mixed borders -> per-side lines
  function borderLines(cs) {
    const sides = ["top", "right", "bottom", "left"];
    const vals = sides.map(s => ({
      w: cs["border-" + s + "-width"],
      s: cs["border-" + s + "-style"],
      c: cs["border-" + s + "-color"]
    }));
    if (vals.every(v => v.s === "none" || v.w === "0px")) return [];
    const uniform = vals.every(v => v.w === vals[0].w && v.s === vals[0].s && v.c === vals[0].c);
    if (uniform) return ["border: " + vals[0].w + " " + vals[0].s + " " + vals[0].c];
    return sides.map((s, i) => "border-" + s + ": " + vals[i].w + " " + vals[i].s + " " + vals[i].c);
  }

  function buildCSS(el) {
    const cs = getComputedStyle(el);
    const lines = [];

    for (const prop of CURATED) {
      // Flex/grid internals only matter on flex/grid containers
      if (FLEX_CONTAINER_PROPS.includes(prop)) {
        if (!cs.display.includes("flex")) continue;
      }
      // Gap applies to both flex and grid containers.
      if (prop === "gap" && !cs.display.includes("flex") && !cs.display.includes("grid")) continue;
      if (prop.startsWith("grid-template") && !cs.display.includes("grid")) continue;

      if (prop === "transition") {
        const hasTransition = cs["transition-duration"].split(",")
          .some(duration => Number.parseFloat(duration) > 0);
        if (hasTransition) lines.push("transition: " + cs.transition);
        continue;
      }

      // Offsets and z-index are meaningless on statically positioned elements
      if (["top", "right", "bottom", "left", "z-index"].includes(prop) && cs.position === "static") continue;

      const val = cs[prop];
      if (!val) continue;
      if (SKIP_VALUES[prop] && SKIP_VALUES[prop].includes(val)) continue;

      lines.push(prop + ": " + val);
    }

    const margin = boxLine("margin", cs);
    if (margin) lines.push(margin);
    const padding = boxLine("padding", cs);
    if (padding) lines.push(padding);
    lines.push(...borderLines(cs));

    return selectorFor(el) + " {\n  " + lines.join(";\n  ") + ";\n}";
  }

  // ---------------------------------------------------------------------------
  // Clipboard — plain text ONLY. Using navigator.clipboard.writeText means the
  // clipboard never receives an HTML flavor, so pasting anywhere (VS Code,
  // Word, DevTools) always yields the raw CSS text, never markup.
  // ---------------------------------------------------------------------------

  async function copyPlainText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback for pages where the async clipboard API is unavailable
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.documentElement.appendChild(ta);
      ta.select();
      const copied = document.execCommand("copy");
      ta.remove();
      if (!copied) throw new Error("The browser denied the clipboard request.");
    }
  }

  // ---------------------------------------------------------------------------
  // Tooltip UI (all styles inline so page stylesheets cannot leak in)
  // ---------------------------------------------------------------------------

  function ensureTooltip() {
    if (tooltip) return;
    tooltip = document.createElement("div");
    tooltip.setAttribute("style", [
      "all: initial",
      "position: fixed",
      "z-index: 2147483647",
      "pointer-events: none",
      "display: none",
      "max-width: 340px",
      "background: #ffffff",
      "border: 1px solid #e2e2e2",
      "border-radius: 8px",
      "box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12)",
      "font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    ].join(";"));

    const head = document.createElement("div");
    head.setAttribute("style", [
      "display: flex",
      "justify-content: space-between",
      "align-items: baseline",
      "gap: 16px",
      "padding: 7px 10px",
      "border-bottom: 1px solid #f0f0f0"
    ].join(";"));

    const sel = document.createElement("span");
    sel.className = "dse-sel";
    sel.setAttribute("style", "font: 600 11px ui-monospace, Consolas, monospace; color: #1a1a1a;");

    const hint = document.createElement("span");
    hint.className = "dse-hint";
    hint.setAttribute("style", "font: 400 10px -apple-system, Segoe UI, Roboto, sans-serif; color: #9a9a9a; white-space: nowrap;");

    head.appendChild(sel);
    head.appendChild(hint);

    const body = document.createElement("pre");
    body.className = "dse-body";
    body.setAttribute("style", [
      "margin: 0",
      "padding: 8px 10px",
      "font: 11px/1.55 ui-monospace, Consolas, monospace",
      "color: #444444",
      "white-space: pre-wrap",
      "word-break: break-word",
      "max-height: 280px",
      "overflow: hidden"
    ].join(";"));

    tooltip.appendChild(head);
    tooltip.appendChild(body);
    document.documentElement.appendChild(tooltip);
  }

  function resetTooltip() {
    tooltip.querySelector(".dse-hint").textContent = "Click to copy · Esc to exit";
    tooltip.querySelector(".dse-body").style.color = "#444444";
  }

  function showTooltip(el) {
    const output = mode === "font" ? buildFontCSS(el) :
      mode === "html" ? buildHTML(el) :
      mode === "tailwind" ? buildTailwind(el) :
      mode === "sandbox" ? buildSandboxExport(el) : buildCSS(el);
    lastCSS = output;

    tooltip.querySelector(".dse-sel").textContent = selectorFor(el);

    // Preview mirrors what will be copied, capped so huge blocks stay readable
    const lines = output.split("\n");
    const MAX = 17;
    let preview = output;
    if ((mode === "html" || mode === "tailwind") && output.length > 1600) {
      preview = output.slice(0, 1600) + (mode === "html"
        ? "\n<!-- … click to copy all HTML -->"
        : "\n… click to copy all Tailwind classes");
    } else if (lines.length > MAX) {
      preview = lines.slice(0, MAX).join("\n") +
        "\n  /* … " + (lines.length - MAX) + " more lines — click to copy all */";
    }
    tooltip.querySelector(".dse-body").textContent = preview;
    tooltip.style.display = "block";
  }

  function placeTooltip(e) {
    if (!tooltip || tooltip.style.display === "none") return;
    const pad = 14;
    const rect = tooltip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
    tooltip.style.left = Math.max(4, x) + "px";
    tooltip.style.top = Math.max(4, y) + "px";
  }

  function flashCopied() {
    tooltip.querySelector(".dse-hint").textContent = "";
    tooltip.querySelector(".dse-body").textContent =
      (mode === "font" ? "Typography" : mode === "html" ? "HTML" : mode === "tailwind" ? "Tailwind classes" : mode === "sandbox" ? "Component sandbox" : "CSS") + " copied to clipboard";
    tooltip.querySelector(".dse-body").style.color = "#1a7f37";
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      stopTimer = null;
      stop();
    }, 600);
  }

  function flashCopyError() {
    tooltip.querySelector(".dse-hint").textContent = "Clipboard access was blocked";
    tooltip.querySelector(".dse-body").style.color = "#b91c1c";
  }

  // ---------------------------------------------------------------------------
  // Inspection lifecycle
  // ---------------------------------------------------------------------------

  function start(newMode) {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    clearDevicePreview();
    if (mode === "none") prevCursor = document.documentElement.style.cursor;
    mode = newMode;
    lastCSS = "";
    ensureTooltip();
    resetTooltip();
    document.documentElement.style.cursor = "crosshair";
  }

  function stop() {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    mode = "none";
    if (currentEl) {
      currentEl.style.outline = prevOutline;
      currentEl = null;
    }
    if (tooltip) tooltip.style.display = "none";
    document.documentElement.style.cursor = prevCursor;
    prevCursor = "";
  }

  function clearDevicePreview() {
    if (!devicePreview) return;
    devicePreview.remove();
    devicePreview = null;
  }

  function showDevicePreview(viewName) {
    clearDevicePreview();
    stop();

    const view = DEVICE_VIEWS[viewName];
    if (!view) return;

    const overlay = document.createElement("div");
    overlay.setAttribute("style", [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "display: flex",
      "flex-direction: column",
      "align-items: center",
      "gap: 10px",
      "padding: 16px",
      "box-sizing: border-box",
      "overflow: auto",
      "background: rgba(15, 23, 42, 0.72)",
      "font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    ].join(";"));

    const controls = document.createElement("div");
    controls.setAttribute("style", "display: flex; align-items: center; gap: 12px; color: #ffffff;");

    const title = document.createElement("span");
    title.textContent = view.label + " · " + view.width + " × " + view.height;
    title.setAttribute("style", "font: 600 13px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;");

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close preview";
    close.setAttribute("style", [
      "appearance: none",
      "border: 1px solid rgba(255, 255, 255, 0.45)",
      "border-radius: 5px",
      "padding: 5px 8px",
      "background: rgba(255, 255, 255, 0.12)",
      "color: #ffffff",
      "font: 500 12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      "cursor: pointer"
    ].join(";"));
    close.addEventListener("click", clearDevicePreview);
    controls.append(title, close);

    const frame = document.createElement("iframe");
    frame.src = window.location.href;
    frame.title = view.label + " website preview";
    frame.setAttribute("style", [
      "display: block",
      "width: " + view.width + "px",
      "height: " + view.height + "px",
      "border: 8px solid #111827",
      "border-radius: " + (viewName === "mobile" ? "28px" : "12px"),
      "background: #ffffff",
      "box-shadow: 0 18px 55px rgba(0, 0, 0, 0.45)"
    ].join(";"));

    overlay.append(controls, frame);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) clearDevicePreview();
    });
    document.documentElement.appendChild(overlay);
    devicePreview = overlay;
  }

  // ---------------------------------------------------------------------------
  // Event handlers — capture phase so the page handlers never fire
  // ---------------------------------------------------------------------------

  function onHover(e) {
    if (mode === "none" || !(e.target instanceof Element)) return;
    if (currentEl) currentEl.style.outline = prevOutline;
    currentEl = e.target;
    prevOutline = currentEl.style.outline;
    showTooltip(currentEl);
    // Build the HTML before adding the temporary inspection outline.
    currentEl.style.outline = "1.5px solid #2563eb";
  }

  function onMove(e) {
    if (mode === "none") return;
    placeTooltip(e);
  }

  function onClick(e) {
    if (mode === "none") return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!lastCSS) return;
    copyPlainText(lastCSS).then(flashCopied).catch(flashCopyError);
  }

  function onKey(e) {
    if (e.key === "Escape" && mode !== "none") {
      e.preventDefault();
      e.stopPropagation();
      stop();
    }
  }

  function suppress(e) {
    if (mode === "none") return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  document.addEventListener("mouseover", onHover, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", suppress, true);
  document.addEventListener("mouseup", suppress, true);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "start_inspect") {
      const m = ["font", "html", "tailwind", "sandbox"].includes(msg.mode) ? msg.mode : "element";
      if (["tailwind", "sandbox"].includes(m)) {
        tailwindVersion = ["v2", "v3"].includes(msg.tailwindVersion) ? msg.tailwindVersion : "v4";
      }
      start(m);
    } else if (msg.action === "stop_inspect") {
      stop();
    } else if (msg.action === "get_inspect_state") {
      sendResponse({ mode, testView: devicePreview ? devicePreview.dataset.view : "none", tailwindVersion });
    } else if (msg.action === "set_test_view") {
      showDevicePreview(msg.view);
      if (devicePreview) devicePreview.dataset.view = msg.view;
    } else if (msg.action === "generate_page_palette") {
      tailwindVersion = ["v2", "v3"].includes(msg.tailwindVersion) ? msg.tailwindVersion : "v4";
      sendResponse({ palette: buildPagePalette() });
    }
  });
})();
