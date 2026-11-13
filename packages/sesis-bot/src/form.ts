/** ASP.NET form helpers. Same approach as the ProviderSoft HTTP client. */

const SKIP_INPUT_TYPES = new Set(["submit", "button", "image", "reset", "file"]);

function matchInputOrButtonTags(html: string): string[] {
  const re = /<(?:input|button)\b(?:[^"'<>]*|"[^"]*"|'[^']*')*>/gi;
  return html.match(re) ?? [];
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return m?.[1];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function pickHidden(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<input[^>]*name=["']${escapeRe(name)}["'][^>]*value=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  if (m?.[1] !== undefined) return decodeHtml(m[1]);
  const re2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${escapeRe(name)}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2?.[1] !== undefined ? decodeHtml(m2[1]) : undefined;
}

/** Hidden + text + checked boxes/radios + selected options + textareas. Skips submit buttons. */
export function collectFormFields(html: string): URLSearchParams {
  const body = new URLSearchParams();

  for (const tag of matchInputOrButtonTags(html)) {
    const name = attr(tag, "name");
    if (!name) continue;
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) continue;
    if (type === "checkbox" || type === "radio") {
      if (!/\bchecked\b/i.test(tag)) continue;
      body.append(decodeHtml(name), decodeHtml(attr(tag, "value") ?? "on"));
      continue;
    }
    body.set(decodeHtml(name), decodeHtml(attr(tag, "value") ?? ""));
  }

  const selectRe = /<select\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/select>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = selectRe.exec(html))) {
    const selectTag = `<select${sm[1]}>`;
    const name = attr(selectTag, "name");
    if (!name) continue;
    const multiple = /\bmultiple\b/i.test(selectTag);
    const inner = sm[2] ?? "";
    const optRe = /<option\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/option>/gi;
    let om: RegExpExecArray | null;
    const selectedVals: string[] = [];
    let first: string | undefined;
    while ((om = optRe.exec(inner))) {
      const optTag = `<option${om[1]}>`;
      const val = attr(optTag, "value") ?? om[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
      if (first === undefined) first = val;
      if (/\bselected\b/i.test(optTag)) selectedVals.push(val);
    }
    if (multiple) {
      for (const v of selectedVals) body.append(decodeHtml(name), decodeHtml(v));
      continue;
    }
    body.set(decodeHtml(name), decodeHtml(selectedVals[0] ?? first ?? ""));
  }

  const taRe = /<textarea\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/textarea>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = taRe.exec(html))) {
    const name = attr(`<textarea${tm[1]}>`, "name");
    if (!name) continue;
    body.set(decodeHtml(name), decodeHtml(tm[2] ?? ""));
  }

  return body;
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Options for one `<select name="...">`. Empty when the control is absent. */
export function listSelectOptions(html: string, fieldName: string): SelectOption[] {
  const selectRe = /<select\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/select>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = selectRe.exec(html))) {
    const selectTag = `<select${sm[1]}>`;
    const name = attr(selectTag, "name");
    if (!name || decodeHtml(name) !== fieldName) continue;
    const inner = sm[2] ?? "";
    const optRe = /<option\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/option>/gi;
    const options: SelectOption[] = [];
    let om: RegExpExecArray | null;
    while ((om = optRe.exec(inner))) {
      const optTag = `<option${om[1]}>`;
      const rawValue = attr(optTag, "value") ?? om[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
      const label = decodeHtml((om[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
      options.push({ value: decodeHtml(rawValue), label });
    }
    return options;
  }
  return [];
}

/** Skip the blank "-- Select --" row. Real status values stay. */
export function isStatusChoice(option: SelectOption): boolean {
  const label = option.label.trim();
  const value = option.value.trim();
  if (!value || !label) return false;
  const letters = label.replace(/[^a-z]/gi, "").toLowerCase();
  if (letters === "select") return false;
  return true;
}

export function statusSlug(label: string): string {
  return label
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
