// Topic and source bubbles, shared by the problem list and the problem page.
// Colours come from labels.json; names it doesn't list keep the default
// look from style.css (.bubble-topic filled, .bubble-source outlined).

/**
 * How one topic or source looks, from labels.json. Every field is optional.
 *
 * @typedef {object} LabelStyle
 * @property {string} [background] - A CSS colour for the bubble.
 * @property {string} [text] - A CSS colour for its text.
 * @property {string} [link] - Reserved; not shown yet.
 */

/**
 * labels.json: the styles of topics and sources, by name.
 *
 * @typedef {{ topics: Record<string, LabelStyle>, sources: Record<string, LabelStyle> }} Labels
 */

/** @type {Labels} */
const EMPTY_LABELS = { topics: {}, sources: {} };

/**
 * Loads labels.json. If it can't be loaded, bubbles still render, just
 * uncoloured.
 *
 * @returns {Promise<Labels>} The labels, or empty ones if they couldn't be
 *   loaded. Never rejects.
 */
async function loadLabels() {
  try {
    const res = await fetch('/labels.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const labels = await res.json();
    return { topics: labels.topics || {}, sources: labels.sources || {} };
  } catch (err) {
    console.warn('Could not load labels.json; using default bubble colours.', err);
    return EMPTY_LABELS;
  }
}

/**
 * Whether a value from labels.json is a real CSS colour. Only those are
 * applied, and only through element.style, so a bad value in labels.json is
 * ignored rather than breaking the page.
 *
 * @param {unknown} value - The value to test.
 * @returns {value is string} True for a string the browser accepts as a
 *   colour. (A type predicate: after a true result, the checker treats
 *   value as a string.)
 */
function isColor(value) {
  return typeof value === 'string' && CSS.supports('color', value);
}

/**
 * Makes one bubble. The name goes in via textContent, never innerHTML, so it
 * can't inject markup.
 *
 * @param {string} name - The topic or source, from the question file.
 * @param {'topics' | 'sources'} kind - Which it is: sources are outlined,
 *   topics filled.
 * @param {Labels} labels - The styles to apply.
 * @returns {HTMLSpanElement} The bubble, not yet in the page.
 */
function makeBubble(name, kind, labels) {
  const el = document.createElement('span');
  el.className = `badge ${kind === 'sources' ? 'bubble-source' : 'bubble-topic'}`;
  el.textContent = name;
  const style = labels[kind][name] || {};
  if (isColor(style.background)) el.style.backgroundColor = style.background;
  if (isColor(style.text)) el.style.color = style.text;
  return el;
}

/**
 * Fills container with the question's sources, then its topics, each in
 * the order the question file lists them, replacing what was there.
 *
 * @param {Element} container - Where the bubbles go.
 * @param {{ sources?: string[], topics?: string[] }} question - The question,
 *   or its summary from the problem list.
 * @param {Labels} labels - The styles to apply.
 * @returns {void}
 */
function renderBubbles(container, question, labels) {
  container.replaceChildren(
    ...(question.sources || []).map((name) => makeBubble(name, 'sources', labels)),
    ...(question.topics || []).map((name) => makeBubble(name, 'topics', labels))
  );
}
