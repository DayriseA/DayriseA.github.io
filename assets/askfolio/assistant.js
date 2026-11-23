// The portfolio's own assistant, built on the Askfolio headless client (Askfolio's
// docs/14-headless-client.md; this script started from its reference example).
// A launcher fixed at the bottom of the viewport opens a <dialog>: a floating, non-modal panel on
// wide screens, so the page stays readable and scrollable, and a full-screen modal sheet on narrow
// ones. It runs as a module: if this file or the client fails to load, nothing runs, the launcher
// stays hidden and the rest of the page is untouched (rule 1).
import { AI_DISCLOSURE, AskfolioClient, messageLength } from "./askfolio-client.js";
import { renderMarkdown } from "./askfolio-markdown.js";

// The service: the local one on a local host, production everywhere else.
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const SERVICE_URL = LOCAL ? "http://localhost:8787" : "https://askfolio-dayrise.fly.dev";

const LOG_KEY = "site:askfolio-log"; // the page's own copy of the messages it shows
const lang = document.documentElement.lang.startsWith("fr") ? "fr" : "en";
const number = (value) => value.toLocaleString(lang);

// The floating panel needs room around it; below this, the panel is a full-screen sheet.
const WIDE = window.matchMedia("(min-width: 700px) and (min-height: 560px)");

// Every text the script writes. The markup holds the others, in each page's language, the topic
// names included (the topic control's options); the AI disclosure comes from the client.
const TEXT = {
  en: {
    newTopic: (name) => `New conversation. Topic: ${name}.`,
    waiting: "Waiting for the assistant…",
    searching: "Looking through the files…",
    reading: (path) => `Reading ${path}`,
    writing: "Writing the answer…",
    checking: "Checking the answer before showing it…",
    sources: "Sources",
    stopped: "Stopped.",
    interrupted: "The answer was interrupted.",
    expired: "Your previous conversation expired. A new one has started.",
    full: "This conversation has reached its maximum length. Your next message starts a new one.",
    humanCheck: "The human check failed. Please try again.",
    network: "The assistant cannot be reached. Check your connection and try again.",
    generic: "Something went wrong. Please try again.",
    badTopic: "This topic is not available.",
    limited: "You have reached the message limit for now. Please come back later.",
    closing: "The previous answer is still closing. Please try again in a few seconds.",
    budget: "The assistant has reached its daily limit and will be back tomorrow.",
    unavailable: "The assistant is currently unavailable.",
    tooLong: (max) => `Your message is too long (${number(max)} characters max).`,
  },
  fr: {
    newTopic: (name) => `Nouvelle conversation. Sujet : ${name}.`,
    waiting: "En attente de l’assistant…",
    searching: "Recherche dans les fichiers…",
    reading: (path) => `Lecture de ${path}`,
    writing: "Rédaction de la réponse…",
    checking: "Vérification de la réponse avant affichage…",
    sources: "Sources",
    stopped: "Réponse arrêtée.",
    interrupted: "La réponse a été interrompue.",
    expired: "Votre conversation précédente a expiré. Une nouvelle conversation a commencé.",
    full: "Cette conversation a atteint sa longueur maximale. Votre prochain message en commencera une nouvelle.",
    humanCheck: "La vérification anti-robot a échoué. Réessayez.",
    network: "L’assistant est injoignable. Vérifiez votre connexion et réessayez.",
    generic: "Une erreur est survenue. Réessayez.",
    badTopic: "Ce sujet n’est pas disponible.",
    limited: "Vous avez atteint la limite de messages pour le moment. Revenez plus tard.",
    closing: "La réponse précédente se termine. Réessayez dans quelques secondes.",
    budget: "L’assistant a atteint sa limite quotidienne et sera de retour demain.",
    unavailable: "L’assistant est momentanément indisponible.",
    tooLong: (max) => `Votre message est trop long (${number(max)} caractères maximum).`,
  },
}[lang];

const $ = (id) => document.getElementById(id);
const launcher = $("askfolio-launcher");
const panel = $("askfolio");
const heading = $("askfolio-title");
const log = $("askfolio-log");
const status = $("askfolio-status");
const live = $("askfolio-live");
const notice = $("askfolio-notice");
const challenge = $("askfolio-turnstile");
const form = $("askfolio-ask");
const question = $("askfolio-question");
const counter = $("askfolio-counter");
const send = $("askfolio-send");
const stop = $("askfolio-stop");
const fresh = $("askfolio-new");
const topic = $("askfolio-topic"); // the topic control: a <select> whose options name the topics
const empty = $("askfolio-empty");
const starters = empty.querySelectorAll("[data-askfolio-starter]");
const topicButtons = document.querySelectorAll("[data-askfolio-scope]"); // on the page

const client = new AskfolioClient({
  serviceUrl: SERVICE_URL,
  turnstile: { container: challenge, size: "flexible", theme: "dark" }, // the panel is dark
});

let scope = client.conversation?.scope ?? "all"; // a page load continues the stored conversation
let turning = false; // a message is in flight
let blocked = null; // { until } while a notice says why nothing can be sent
let timer = 0;
let checking = null; // a health check under way, after a notice
let spoken = new Set(); // the progress stages already announced in this turn
let scrolled = false; // the log has been scrolled to its latest messages once, after opening
let reopen = null; // { focus } while the panel is reopened in the other mode
let opener = null; // the topic button that opened the panel, which gets the focus back on close
let pending = null; // a topic chosen on the page during a turn, applied when the turn ends
let drafted = null; // the scope of the draft a topic button put in the field, while untouched

// ─── Start: only when the service can answer (rule 1) ─────────────────────────────────────────

const health = await client.health();
if (health.status !== "unavailable") {
  $("askfolio-disclosure").textContent = AI_DISCLOSURE[lang];
  topic.value = scope;
  if (topic.value !== scope) {
    // A stored topic this page does not offer (any more): its conversation is not continued.
    scope = topic.value = "all";
    client.newConversation();
  }
  showStarter();
  showLog();
  if (health.status === "budget_exhausted") block(TEXT.budget, health.retryAt);
  count();
  launcher.hidden = false;
  for (const button of topicButtons) button.hidden = false;
  followPage();
}

// ─── The page's message log (the service returns no history) ─────────────────────────────────

function readLog() {
  try {
    return JSON.parse(sessionStorage.getItem(LOG_KEY)) ?? {};
  } catch {
    return {};
  }
}

function writeLog(value) {
  try {
    if (value === null) sessionStorage.removeItem(LOG_KEY);
    else sessionStorage.setItem(LOG_KEY, JSON.stringify(value));
  } catch {
    // Without storage, the messages are simply not shown again after a page load.
  }
}

function showLog() {
  const saved = readLog();
  if (saved.id !== undefined && saved.id === client.conversation?.id) {
    try {
      for (const [who, text] of saved.items) bubble(who, text);
    } catch {
      // A record of another shape (a format change, a corrupted write): dropped, not drawn.
      log.replaceChildren();
      writeLog(null);
    }
  } else writeLog(null); // the conversation it belonged to is gone (expired, or another tab)
}

function keep(conversationId, asked, answered) {
  if (conversationId === null) return; // not saved by the service: not shown again either
  const saved = readLog();
  const items = saved.id === conversationId ? saved.items : [];
  writeLog({ id: conversationId, items: [...items, ["visitor", asked], ["assistant", answered]] });
}

// ─── Drawing: text through textContent, answers through renderMarkdown, never innerHTML ───────

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function bubble(who, text = "") {
  const item = log.appendChild(element("li", undefined, `is-${who}`));
  if (who === "assistant") item.replaceChildren(renderMarkdown(text));
  else item.textContent = text;
  return item;
}

function note(text, before = null, className = "is-note") {
  if (text === "") return;
  log.insertBefore(element("li", text, className), before);
  if (before === null) log.scrollTop = log.scrollHeight;
  announce(text);
  refresh();
}

/** Scrolls the log, not the page, so that `item` is at its top. Instant: no motion to reduce. */
function reveal(item) {
  log.scrollTop += item.getBoundingClientRect().top - log.getBoundingClientRect().top;
}

function announce(text) {
  live.textContent = text;
}

function showSources(item, files) {
  if (files.length === 0) return;
  const list = element("ul");
  for (const file of files) {
    list.append(element("li", file.projectId ? `${file.path} (${file.projectId})` : file.path));
  }
  const details = element("details", undefined, "askfolio__sources");
  details.append(element("summary", TEXT.sources), list);
  item.append(details);
}

function progressText({ stage, tool, path }) {
  if (stage === "writing") return TEXT.writing;
  if (stage === "verifying") return TEXT.checking;
  if (tool === "read_file" && path !== undefined) return TEXT.reading(path);
  return TEXT.searching;
}

function setStatus(text, stage) {
  status.textContent = text;
  if (stage !== undefined && !spoken.has(stage)) {
    spoken.add(stage);
    announce(text);
  }
}

// ─── States: what can be sent, and the notices ────────────────────────────────────────────────

function refresh() {
  const tooLong = messageLength(question.value) > client.limits.maxMessageChars;
  send.disabled = blocked !== null || tooLong;
  send.hidden = turning; // Stop takes Send's place during a turn
  stop.hidden = !turning;
  fresh.disabled = turning;
  topic.disabled = turning; // a turn keeps the scope it was sent in
  fresh.hidden = log.children.length === 0 && client.conversation === null;
  log.setAttribute("aria-busy", String(turning));
  panel.classList.toggle("is-busy", turning);
  launcher.classList.toggle("is-busy", turning);
}

function block(text, until, withContact = true) {
  blocked = { until: until ?? 0 };
  notice.hidden = false;
  challenge.hidden = true; // no challenge, nor its last state ("Success"), under the notice
  notice.querySelector(".askfolio__notice-text").textContent = text;
  notice.querySelector(".askfolio__contact").hidden = !withContact;
  announce(text);
  refresh();
}

function unblock() {
  clearTimeout(timer);
  const inNotice = notice.contains(document.activeElement);
  blocked = null;
  notice.hidden = true;
  challenge.hidden = false; // in the layout again before the next session is needed
  refresh();
  if (inNotice) question.focus();
}

/** Blocks sending for `seconds`, then lets the visitor send again. */
function pause(text, seconds, withContact) {
  block(text, Date.now() + seconds * 1000, withContact);
  clearTimeout(timer);
  timer = setTimeout(unblock, seconds * 1000);
}

/**
 * Once a notice's time has passed, asks health again, on a visitor's action only: the focus
 * coming into the panel. Concurrent calls share one request.
 */
function recheck() {
  if (blocked === null || Date.now() < blocked.until) return Promise.resolve();
  checking ??= client.health().then((answer) => {
    checking = null;
    if (answer.status === "available") unblock();
    else if (answer.status === "budget_exhausted") block(TEXT.budget, answer.retryAt);
    else block(TEXT.unavailable, Date.now() + 60_000);
  });
  return checking;
}

function count() {
  const max = client.limits.maxMessageChars;
  const length = messageLength(question.value);
  counter.textContent = length > max ? TEXT.tooLong(max) : `${number(length)}/${number(max)}`;
  counter.classList.toggle("is-over", length > max);
  refresh();
}

/** Every failure, as something the visitor sees. `say` writes a one-line message. */
function fail(error, say) {
  switch (error.kind) {
    case "aborted":
      return say(TEXT.stopped);
    case "busy":
      return; // Send is replaced by Stop during a turn
    case "input":
      if (error.code === "invalid_scope") return say(TEXT.badTopic);
      return say(error.code === "message_too_long" ? TEXT.tooLong(error.limit) : "");
    case "turnstile":
      return say(TEXT.humanCheck);
    case "unavailable":
      return error.status === "budget_exhausted"
        ? block(TEXT.budget, Date.now() + 3_600_000)
        : block(TEXT.unavailable, Date.now() + 60_000);
    case "network":
      return say(TEXT.network);
    case "dropped":
    case "stream":
      return say(TEXT.interrupted);
    case "http":
      if (error.code === "rate_limited") {
        // Three causes, one code: a short Retry-After is a stream still closing (after a stop).
        const seconds = error.retryAfter ?? 60;
        return seconds <= 5 ? pause(TEXT.closing, seconds, false) : pause(TEXT.limited, seconds);
      }
      if (error.code === "budget_exhausted") {
        return block(TEXT.budget, Date.now() + (error.retryAfter ?? 3600) * 1000);
      }
      if (error.code === "service_unavailable") return block(TEXT.unavailable, Date.now() + 60_000);
      if (error.code === "conversation_limit") {
        client.newConversation();
        return say(TEXT.full);
      }
      if (error.code === "invalid_scope") return say(TEXT.badTopic);
      return say(TEXT.generic);
  }
}

// ─── The panel: open, close, and the mode that fits the viewport ─────────────────────────────

/**
 * Opens the panel; `focus` is where the focus goes, `undefined` for the default target, `null`
 * for the caller to move it.
 */
function openPanel(focus) {
  if (panel.open) return;
  if (WIDE.matches) panel.show();
  else {
    fitSheet();
    panel.showModal(); // the browser makes the page inert, traps the focus and handles Escape
  }
  launcher.hidden = true;
  if (!scrolled) {
    scrolled = true;
    log.scrollTop = log.scrollHeight; // the latest messages in view: a closed log cannot scroll
  }
  if (focus !== undefined) focus?.focus();
  // On a wide screen, straight to the question. On a narrow one, focusing the field would
  // raise the virtual keyboard over the panel at once: the heading takes the focus instead.
  else if (panel.matches(":modal")) heading.focus();
  else question.focus();
}

launcher.addEventListener("click", () => {
  opener = null;
  openPanel();
});
$("askfolio-close").addEventListener("click", () => panel.close());

/** Whether the topic control's own list is open (a customizable select draws it in the page). */
function picking() {
  try {
    return topic.matches(":open");
  } catch {
    return false; // a browser without :open draws a native list, whose keys never reach the page
  }
}

// A modal sheet gets Escape from the browser; the floating panel handles it here, unless Escape
// is closing the topic list.
panel.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.isComposing && !panel.matches(":modal") && !picking()) {
    event.preventDefault();
    panel.close();
  }
});

panel.addEventListener("close", () => {
  if (reopen !== null) {
    const { focus } = reopen;
    reopen = null;
    return openPanel(focus);
  }
  launcher.hidden = false;
  // Back to the topic button that opened the panel, if the page still shows it.
  const back = opener?.isConnected && opener.getClientRects().length > 0 ? opener : launcher;
  opener = null;
  back.focus();
});

// Crossing the breakpoint while the panel is open: reopen it in the mode that fits.
WIDE.addEventListener("change", () => {
  if (!panel.open || panel.matches(":modal") !== WIDE.matches) return;
  reopen = { focus: panel.contains(document.activeElement) ? document.activeElement : null };
  panel.close();
});

// The sheet follows the visual viewport, so that a virtual keyboard never covers the question.
function fitSheet() {
  const view = window.visualViewport;
  if (view === undefined || view === null) return;
  panel.style.setProperty("--askfolio-view-height", `${view.height}px`);
  panel.style.setProperty("--askfolio-view-top", `${view.offsetTop}px`);
}

window.visualViewport?.addEventListener("resize", fitSheet);
window.visualViewport?.addEventListener("scroll", fitSheet);

// The launcher follows the page. It rises above the footer when the page reaches it, so that it
// never covers the footer's link nor the contact buttons above it. On a phone, it shows its label
// while the page is at its top, and folds to the dial alone once the visitor scrolls down to read.
function followPage() {
  const footer = document.querySelector(".foot");
  let frame = 0;
  const lift = () => {
    frame = 0;
    launcher.classList.toggle("is-folded", window.scrollY > 48);
    if (footer === null) return;
    const overlap = Math.max(0, window.innerHeight - footer.getBoundingClientRect().top);
    launcher.style.setProperty("--askfolio-lift", `${Math.round(overlap)}px`);
  };
  const queue = () => {
    frame ||= requestAnimationFrame(lift);
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  lift();
}

// ─── Topics: the control in the header, the buttons on the page, the suggested questions ──────

/** The topic's name, as the topic control's option writes it in the page's language. */
function topicName(value) {
  return [...topic.options].find((option) => option.value === value)?.text ?? value;
}

/** The invitation and the suggested questions that fit the topic, for the empty conversation. */
function showStarter() {
  const kind = scope.startsWith("project:") ? "project" : scope;
  for (const starter of starters) starter.hidden = starter.dataset.askfolioStarter !== kind;
}

/**
 * Switches to the topic `next`. A new topic ends the conversation now, so that coming back to the
 * previous topic never continues it (the client alone would continue a conversation whose scope
 * matches again); a log that shows messages gets a divider. A topic button's draft the visitor
 * left untouched goes with its topic. During a turn, the change waits for the turn's end: the turn
 * keeps the scope it was sent in.
 */
function setTopic(next) {
  if (turning) {
    pending = next === scope ? null : next;
    return;
  }
  topic.value = next;
  if (next === scope) return;
  scope = next;
  client.newConversation();
  showStarter();
  if (drafted !== null && drafted !== next) {
    question.value = "";
    drafted = null;
    count();
  }
  if (log.children.length > 0) {
    note(TEXT.newTopic(topicName(next)), null, "is-note is-divider"); // announced, like every note
  }
}

topic.addEventListener("change", () => setTopic(topic.value));

// A topic button: opens the panel if it is closed, switches the topic, offers its draft (never
// sent by itself) and moves the focus to the question. The draft goes in an empty field, or
// replaces a draft the visitor left untouched; what the visitor wrote or chose is kept. The focus
// coming into the panel asks health again when a notice's time has passed (see recheck).
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-askfolio-scope]");
  if (button === null || button === undefined || button.hidden) return;
  opener = button;
  openPanel(null); // open first, so that a divider is announced from the panel
  setTopic(button.dataset.askfolioScope);
  const draft = button.dataset.askfolioDraft;
  if (draft !== undefined && (question.value === "" || drafted !== null)) {
    question.value = draft;
    drafted = button.dataset.askfolioScope;
    count();
  }
  question.focus();
});

// A suggested question goes into the field, ready to send or to edit; never sent by itself.
empty.addEventListener("click", (event) => {
  const suggestion = event.target.closest(".askfolio__suggestion");
  if (suggestion === null) return;
  question.value = suggestion.textContent.trim();
  drafted = null; // the visitor's choice
  count();
  question.focus();
});

// ─── A chat turn ──────────────────────────────────────────────────────────────────────────────

panel.addEventListener("focusin", recheck);

question.addEventListener("focus", async () => {
  await recheck(); // the health check a notice may need comes first
  if (client.session !== null || blocked !== null) return;
  const result = await client.connect(); // Turnstile runs while the visitor types
  if (result.ok) count(); // the session's limits replace the service's defaults
  else if (result.error.kind !== "aborted" && !turning) fail(result.error, note);
});

question.addEventListener("input", () => {
  drafted = null; // the visitor's own text now, whatever it says
  count();
});

question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

stop.addEventListener("click", () => client.stop());

fresh.addEventListener("click", () => {
  client.newConversation();
  writeLog(null);
  log.replaceChildren();
  refresh(); // hides this button: the focus moves to the question
  question.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (blocked !== null) await recheck(); // at once before the notice's time: no request
  const asked = question.value;
  const length = messageLength(asked);
  if (turning || blocked !== null || length === 0 || length > client.limits.maxMessageChars) return;
  question.value = ""; // cleared now: what the visitor types during the turn is kept
  drafted = null;
  count();
  const sent = bubble("visitor", asked);
  const answer = bubble("assistant");
  log.scrollTop = log.scrollHeight; // the question in view, its answer below it
  let frame = 0;
  let draw = null;
  let final = false;
  const fromSend = document.activeElement === send;
  turning = true;
  spoken = new Set();
  refresh();
  if (fromSend) stop.focus(); // Send is hidden: the focus goes to Stop, which took its place
  setStatus(TEXT.waiting);
  const result = await client.sendMessage({
    scope,
    message: asked,
    onText: (text, isFinal) => {
      // The whole text so far: replace what is shown, never append. The final text wins.
      setStatus("");
      cancelAnimationFrame(frame);
      draw = () => {
        const following = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
        answer.replaceChildren(renderMarkdown(text));
        if (following) reveal(sent); // until the question reaches the top; never once scrolled
      };
      if (isFinal) {
        final = true;
        draw();
        draw = null;
      } else frame = requestAnimationFrame(draw);
    },
    onProgress: (progress) => setStatus(progressText(progress), progress.stage),
    onConversationExpired: () => note(TEXT.expired, answer),
  });
  cancelAnimationFrame(frame); // no late frame: what streamed is drawn now, above any notice
  draw?.();
  const fromStop = document.activeElement === stop;
  turning = false;
  setStatus("");
  refresh();
  if (result.ok) {
    announce(answer.textContent); // the answer as text, before its sources are added
    showSources(answer, result.value.sources);
    keep(result.value.conversationId, asked, result.value.text);
    refresh();
  } else {
    if (answer.childNodes.length === 0) answer.remove(); // nothing arrived: no empty answer
    fail(result.error, note);
    if (!final && question.value === "") {
      question.value = asked; // back in the input to send again, unless they typed since
      count();
    }
  }
  if (pending !== null) {
    setTopic(pending); // a topic button pressed during the turn
    pending = null;
  }
  // Stop is hidden again: once the result's state is drawn, the focus goes back to Send, or to
  // the question when a notice disabled Send.
  if (fromStop) (send.disabled ? question : send).focus();
});
