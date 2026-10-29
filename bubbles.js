// Topic and source bubbles, shared by the problem list and the problem page.
// Colours come from labels.json; names it doesn't list keep the default
// look from style.css (.bubble-topic filled, .bubble-source outlined).

const EMPTY_LABELS = { topics: {}, sources: {} };

// If labels.json can't be loaded, bubbles still render, just uncoloured.
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

// Only real CSS colours are applied, and only through element.style, so a
// bad value in labels.json is ignored rather than breaking the page.
function isColor(value) {
  return typeof value === 'string' && CSS.supports('color', value);
}

// kind is 'topics' or 'sources'. The name goes in via textContent, never
// innerHTML, so it can't inject markup.
function makeBubble(name, kind, labels) {
  const el = document.createElement('span');
  el.className = `badge ${kind === 'sources' ? 'bubble-source' : 'bubble-topic'}`;
  el.textContent = name;
  const style = labels[kind][name] || {};
  if (isColor(style.background)) el.style.backgroundColor = style.background;
  if (isColor(style.text)) el.style.color = style.text;
  return el;
}

// Fills container with the question's sources, then its topics, each in
// the order the question file lists them.
function renderBubbles(container, question, labels) {
  container.replaceChildren(
    ...(question.sources || []).map((name) => makeBubble(name, 'sources', labels)),
    ...(question.topics || []).map((name) => makeBubble(name, 'topics', labels))
  );
}
