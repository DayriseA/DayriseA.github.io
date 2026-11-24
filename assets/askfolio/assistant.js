// The portfolio's own assistant, built on the Askfolio headless client (Askfolio's
// docs/14-headless-client.md; this script started from its reference example).
// A launcher fixed at the bottom of the viewport opens a <dialog>: a floating, non-modal panel on
// wide screens, so the page stays readable and scrollable, and a full-screen modal sheet on narrow
// ones. The panel has two views, switched by tabs in its header: the conversation, and the
// job-offer analysis, where a recruiter pastes an offer or uploads it as a PDF and gets a report.
// The client follows one conversation at a time: when a new one starts, the log folds the previous
// one into a single collapsed entry, which the visitor may unfold to read it again. The floating
// panel takes the height its content needs, up to just under the page's top bar.
// Three notices the visitor can close (placards) say what to know before using a view: the privacy
// notice above the question, what an analysis will be above the offer, and each report's own
// disclaimer above its summary. A closed notice is gone, for the tab ("OK") or for every visit
// ("Don't show again"); a privacy link in the header takes the place of the first two. The AI
// disclosure in the header never closes.
// It runs as a module: if this file or the client fails to load, nothing runs, the launcher stays
// hidden and the rest of the page is untouched (rule 1).
import {
  AI_DISCLOSURE,
  AskfolioClient,
  messageLength,
  offerTextLength,
} from "./askfolio-client.js";
import { renderMarkdown } from "./askfolio-markdown.js";

// The service: the local one on a local host, production everywhere else.
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const SERVICE_URL = LOCAL ? "http://localhost:8787" : "https://askfolio-dayrise.fly.dev";

const LOG_KEY = "site:askfolio-log"; // the page's own copy of the messages it shows
// The notices the visitor closed: in sessionStorage for "OK" (this tab), in localStorage for "Don't
// show again" (every visit). One key in both, holding a list of the ids below.
const NOTICES_KEY = "site:askfolio-notices";
const NOTICE_IDS = ["chat", "offer", "report"];
const STORES = { session: () => sessionStorage, always: () => localStorage }; // either may throw
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const lang = document.documentElement.lang.startsWith("fr") ? "fr" : "en";
const number = (value) => value.toLocaleString(lang);
const kilobytes = (bytes) => number(Math.max(1, Math.round(bytes / 1024)));
const megabytes = (bytes) => number(Math.round(bytes / 104_857.6) / 10);

// The floating panel needs room around it; below this, the panel is a full-screen sheet.
const WIDE = window.matchMedia("(min-width: 700px) and (min-height: 560px)");

// Every text the script writes. The markup holds the others, in each page's language, the topic
// names included (the topic control's options); the AI disclosure comes from the client.
const TEXT = {
  en: {
    newTopic: (name) => `New conversation. Topic: ${name}.`,
    past: (name) => `Previous conversation: ${name}`,
    asked: (count) => (count === 1 ? "1 question" : `${number(count)} questions`),
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
    readingOffer: "Reading the job offer…",
    writingReport: "Writing the report…",
    checkingReport: "Checking the report before showing it…",
    offerStopped: "Analysis stopped.",
    offerInterrupted: "The analysis was interrupted.",
    offerLimited: "You have reached the usage limit for now. Please come back later.",
    offerClosing: "The previous request is still closing. Please try again in a few seconds.",
    offerType: "Only PDF files are accepted.",
    offerSize: (bytes) => `The file is too large (${megabytes(bytes)} MB max).`,
    offerUnreadable: "The text of this PDF could not be read. Please paste the offer instead.",
    offerShort: "This text is too short to be a job offer.",
    offerLong: (max) => `This text is too long (${number(max)} characters max).`,
    offerHint: (bytes, pages) => `Up to ${megabytes(bytes)} MB and ${number(pages)} pages.`,
    fileSize: (bytes) => (bytes < 1_048_576 ? `${kilobytes(bytes)} KB` : `${megabytes(bytes)} MB`),
    summary: "Summary",
    requirements: "Requirements",
    importance: { must: "Required", nice: "Nice to have" },
    match: {
      strong: "Strong match",
      partial: "Partial match",
      none: "No evidence found",
      unknown: "Cannot be assessed",
    },
    gaps: "Gaps",
    questions: "Questions to ask Adrien",
    truncated: "The offer was long: only its first part was analyzed.",
    aboutReport: "About this report",
    ok: "OK",
    never: "Don’t show again",
  },
  fr: {
    newTopic: (name) => `Nouvelle conversation. Sujet : ${name}.`,
    past: (name) => `Conversation précédente : ${name}`,
    asked: (count) => (count === 1 ? "1 question" : `${number(count)} questions`),
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
    readingOffer: "Lecture de l’offre d’emploi…",
    writingReport: "Rédaction du rapport…",
    checkingReport: "Vérification du rapport avant affichage…",
    offerStopped: "Analyse arrêtée.",
    offerInterrupted: "L’analyse a été interrompue.",
    offerLimited: "Vous avez atteint la limite d’utilisation pour le moment. Revenez plus tard.",
    offerClosing: "La requête précédente se termine. Réessayez dans quelques secondes.",
    offerType: "Seuls les fichiers PDF sont acceptés.",
    offerSize: (bytes) => `Le fichier est trop volumineux (${megabytes(bytes)} Mo maximum).`,
    offerUnreadable: "Le texte de ce PDF n’a pas pu être lu. Collez plutôt le texte de l’offre.",
    offerShort: "Ce texte est trop court pour être une offre d’emploi.",
    offerLong: (max) => `Ce texte est trop long (${number(max)} caractères maximum).`,
    offerHint: (bytes, pages) => `Jusqu’à ${megabytes(bytes)} Mo et ${number(pages)} pages.`,
    fileSize: (bytes) => (bytes < 1_048_576 ? `${kilobytes(bytes)} Ko` : `${megabytes(bytes)} Mo`),
    summary: "Résumé",
    requirements: "Exigences du poste",
    importance: { must: "Requises", nice: "Appréciées" },
    match: {
      strong: "Correspondance forte",
      partial: "Correspondance partielle",
      none: "Aucun élément trouvé",
      unknown: "Impossible à évaluer",
    },
    gaps: "Écarts",
    questions: "Questions à poser à Adrien",
    truncated: "L’offre était longue : seule sa première partie a été analysée.",
    aboutReport: "À propos de ce rapport",
    ok: "OK",
    never: "Ne plus afficher",
  },
}[lang];

// The words of a job-offer turn, where they differ from a message's.
const OFFER_TEXT = {
  ...TEXT,
  writing: TEXT.writingReport,
  checking: TEXT.checkingReport,
  stopped: TEXT.offerStopped,
  interrupted: TEXT.offerInterrupted,
  limited: TEXT.offerLimited,
  closing: TEXT.offerClosing,
};

const $ = (id) => document.getElementById(id);
const launcher = $("askfolio-launcher");
const panel = $("askfolio");
const heading = $("askfolio-title");
const log = $("askfolio-log");
const statuses = panel.querySelectorAll(".askfolio__status"); // one per view: a turn shows in both
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
const viewButtons = document.querySelectorAll("[data-askfolio-view]"); // on the page
// The two views and their tabs, in the panel's header.
const tabs = [...panel.querySelectorAll('[role="tab"]')];
const views = { chat: $("askfolio-view-chat"), offer: $("askfolio-view-offer") };
const tabMark = $("askfolio-tab-mark"); // a report arrived while the conversation was shown
const main = panel.querySelector(".askfolio__main"); // both views, under the header
// The job-offer view: its form, then the report that replaces it once one arrives.
const sheet = $("askfolio-sheet");
const offerForm = $("askfolio-offer");
const offerText = $("askfolio-offer-text");
const offerPdf = $("askfolio-offer-pdf");
const offerHint = $("askfolio-offer-hint");
const chosen = $("askfolio-offer-chosen");
const offerError = $("askfolio-offer-error");
const report = $("askfolio-report");
const analyse = $("askfolio-analyse");
const offerStop = $("askfolio-offer-stop");
const another = $("askfolio-another");
const toReport = $("askfolio-to-report");
// The notices of the markup, and the privacy link that stands for them once they are closed.
const placards = { chat: $("askfolio-placard-chat"), offer: $("askfolio-placard-offer") };
const privacy = $("askfolio-privacy");

const client = new AskfolioClient({
  serviceUrl: SERVICE_URL,
  turnstile: { container: challenge, size: "flexible", theme: "dark" }, // the panel is dark
});

let scope = client.conversation?.scope ?? "all"; // a page load continues the stored conversation
let turning = false; // a message or a job offer is in flight (one turn per client)
let blocked = null; // { until } while a notice says why nothing can be sent
let timer = 0;
let checking = null; // a health check under way, after a notice
let spoken = new Set(); // the progress stages already announced in this turn
let scrolled = false; // the log has been scrolled to its latest messages once, after opening
let reopen = null; // { focus } while the panel is reopened in the other mode
let opener = null; // the topic button that opened the panel, which gets the focus back on close
let pending = null; // a topic chosen on the page during a turn, applied when the turn ends
let drafted = null; // the scope of the draft a topic button put in the field, while untouched
let full = false; // the conversation in the log reached its maximum length: the next send folds it
let within = false; // the visitor's last click or focus was in the panel
let grown = 0; // the height the floating panel's content asked for since it was opened, in px
let opening = false; // the floating panel opened in this frame: it is sized before it is drawn
let view = "chat"; // the view shown: "chat" or "offer"
let showing = "form"; // what the job-offer view shows: "form" or "report"
const scrolls = { chat: null, form: 0, report: 0 }; // where each view was last scrolled, shown
const closed = new Set([...closedIn("session"), ...closedIn("always")]); // the notices closed

// ─── Start: only when the service can answer (rule 1) ─────────────────────────────────────────

const health = await client.health();
if (health.status !== "unavailable") {
  $("askfolio-disclosure").textContent = AI_DISCLOSURE[lang];
  for (const [id, placard] of Object.entries(placards)) placard.hidden = closed.has(id);
  showPrivacy();
  topic.value = scope;
  if (topic.value !== scope) {
    // A stored topic this page does not offer (any more): its conversation is not continued.
    scope = topic.value = "all";
    client.newConversation();
  }
  showStarter();
  showLog();
  if (health.status === "budget_exhausted") block(TEXT.budget, health.retryAt);
  limitsChanged();
  launcher.hidden = false;
  for (const button of [...topicButtons, ...viewButtons]) button.hidden = false;
  followPage();
}

// ─── The notices the visitor closes ───────────────────────────────────────────────────────────

/** The notice ids closed in one store; a value of another shape is ignored, never thrown on. */
function closedIn(store) {
  try {
    const ids = JSON.parse(STORES[store]().getItem(NOTICES_KEY));
    return Array.isArray(ids) ? ids.filter((id) => NOTICE_IDS.includes(id)) : [];
  } catch {
    return [];
  }
}

function remember(id, store) {
  closed.add(id);
  try {
    const ids = new Set([...closedIn(store), id]);
    STORES[store]().setItem(NOTICES_KEY, JSON.stringify([...ids]));
  } catch {
    // Without storage, the notice stays closed for the page's life.
  }
}

/**
 * The privacy link in the header, unless the notice in view holds it already. While a blocking
 * notice is shown, the notices step aside (CSS) and the link stands for them.
 */
function showPrivacy() {
  const holder = view === "chat" ? "chat" : showing === "form" ? "offer" : null;
  privacy.hidden = holder !== null && !closed.has(holder) && blocked === null;
}

/**
 * Closes a notice for the tab (`store` "session": its "OK", or using the view) or for every
 * visit ("always"). It collapses, then leaves the layout, a report's notice the report itself.
 * The focus moves on from it to where the visitor goes next: the field under it, or the report;
 * with `moveFocus` for a button of the notice (a pointer may not have focused it), else only
 * from inside it.
 */
function closeNotice(placard, store, moveFocus = false) {
  const id = placard.dataset.askfolioPlacard;
  remember(id, store);
  showPrivacy();
  if (placard.inert) return; // already closing
  if (moveFocus || placard.contains(document.activeElement)) {
    if (id === "report") report.focus({ preventScroll: true });
    else fieldOf(id).focus();
  }
  placard.inert = true;
  const animations = [];
  const done = () => {
    if (id === "report") placard.remove();
    else Object.assign(placard, { hidden: true, inert: false });
    for (const animation of animations) animation.cancel(); // held at their end until now
  };
  if (REDUCED.matches || placard.getClientRects().length === 0) return done();
  // A short collapse: its height, its spacing and its frame go to nothing as it fades.
  const timing = { duration: 200, easing: "cubic-bezier(.4, 0, .6, 1)", fill: "forwards" };
  const { marginTop, marginBottom, paddingTop, paddingBottom } = getComputedStyle(placard);
  const from = { marginTop, marginBottom, paddingTop, paddingBottom };
  const to = { marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" };
  Object.assign(from, { height: `${placard.offsetHeight}px`, opacity: 1 });
  Object.assign(to, { height: "0px", opacity: 0, borderWidth: "0px" });
  animations.push(placard.animate([from, to], timing));
  // In a report, the part after it becomes the first: its top spacing and rule leave with it.
  const next = id === "report" ? placard.nextElementSibling : null;
  const first = { marginTop: "0px", paddingTop: "0px", borderTopColor: "transparent" };
  if (next !== null) animations.push(next.animate([first], timing));
  animations[0].finished.then(done, done);
}

/**
 * Using a view closes its notice for the tab, once the service is really answering: at the first
 * progress or text of the turn, or its result. A turn that never reached it (a failed human check,
 * no network, a refused input, a notice, a stop before anything came) leaves the notice shown.
 */
function used(id) {
  if (!closed.has(id)) closeNotice(placards[id], "session");
}

panel.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-askfolio-close]");
  if (button === null || button === undefined) return;
  const placard = button.closest("[data-askfolio-placard]");
  closeNotice(placard, button.dataset.askfolioClose === "always" ? "always" : "session", true);
});

/** The report's disclaimer, as a notice: the service's text, in the report's language. */
function reportNotice(disclaimer, language) {
  const placard = element("div", undefined, "askfolio__placard askfolio__placard--report");
  placard.lang = document.documentElement.lang; // its label and its actions
  placard.setAttribute("role", "group");
  placard.setAttribute("aria-label", TEXT.aboutReport);
  placard.dataset.askfolioPlacard = "report";
  const actions = element("div", undefined, "askfolio__placard-actions");
  for (const [store, text, className] of [
    ["session", TEXT.ok, "askfolio__placard-ok"],
    ["always", TEXT.never, "askfolio__placard-never"],
  ]) {
    const button = element("button", text, className);
    button.type = "button";
    button.dataset.askfolioClose = store;
    actions.append(button);
  }
  const text = element("p", disclaimer, "askfolio__placard-text");
  text.lang = language;
  placard.append(text, actions);
  return placard;
}

// ─── The page's message log (the service returns no history) ─────────────────────────────────

function readLog() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LOG_KEY));
    const valid = (item) =>
      Array.isArray(item) &&
      ["visitor", "assistant"].includes(item[0]) &&
      typeof item[1] === "string";
    // A record of another shape (another script, an older version of this one) is ignored.
    return Array.isArray(saved?.items) && saved.items.every(valid) ? saved : {};
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
  showStarted();
  return item;
}

function note(text, before = null, className = "is-note") {
  if (text === "") return;
  // A note written above the answer in flight must not leave that answer below the fold: a log
  // that showed its latest messages keeps showing them.
  const following = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.insertBefore(element("li", text, className), before);
  showStarted();
  grow();
  if (before === null || following) log.scrollTop = log.scrollHeight;
  announce(text);
  refresh();
}

/** The entries of the conversation the client follows: those after the last folded conversation. */
function current() {
  const items = [...log.children];
  return items.slice(items.findLastIndex((item) => item.classList.contains("is-past")) + 1);
}

/**
 * The log's state for the layout: whether the current conversation shows anything yet. Until it
 * does, its invitation and suggestions are shown under the folded conversations (CSS).
 */
function showStarted() {
  log.classList.toggle("is-started", current().length > 0);
}

/**
 * Folds `items`, the entries of a conversation that has ended, into one collapsed entry at their
 * place in the log, named after its topic (the topic control's option) and its number of
 * questions: a native <details>, which the keyboard and screen readers operate, and whose folded
 * content is out of the focus order. The nodes move as they are, never drawn again. Notes alone (a
 * failed connection) are no conversation: they go. Call it before the topic changes.
 */
function fold(items = current()) {
  full = false;
  writeLog(null); // the stored copy belonged to the conversation that ends
  if (items.length === 0) return;
  if (!items.some((item) => item.matches(".is-visitor, .is-assistant"))) {
    for (const item of items) item.remove();
    return showStarted();
  }
  const asked = items.filter((item) => item.classList.contains("is-visitor")).length;
  // A focus inside them (an answer's link or sources) would fall to the page once they are folded:
  // it goes to the folded entry's row instead.
  const focused = items.some((item) => item.contains(document.activeElement));
  const summary = element("summary");
  summary.append(
    element("span", TEXT.past(topicName(scope)), "askfolio__past-name"),
    element("span", ", ", "vh"), // read between the two, which only the layout separates
    element("span", TEXT.asked(asked), "askfolio__past-count"),
  );
  const past = element("ol", undefined, "askfolio__past-log");
  const details = element("details", undefined, "askfolio__past");
  const entry = element("li", undefined, "is-past");
  log.insertBefore(entry, items[0]);
  past.append(...items);
  details.append(summary, past);
  entry.append(details);
  if (focused) summary.focus();
  showStarted();
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

/** The progress label; `words` holds a job offer's own words for writing and checking. */
function progressText({ stage, tool, path }, words = TEXT) {
  if (stage === "writing") return words.writing;
  if (stage === "verifying") return words.checking;
  if (tool === "read_file" && path !== undefined) return TEXT.reading(path);
  return tool === undefined ? TEXT.readingOffer : TEXT.searching; // no tool: an offer being read
}

/** The status line of both views, so that a turn shows in the view the visitor is looking at. */
function setStatus(text, stage) {
  for (const line of statuses) line.textContent = text;
  if (stage !== undefined && !spoken.has(stage)) {
    spoken.add(stage);
    announce(text);
  }
}

// ─── States: what can be sent, and the notices ────────────────────────────────────────────────

function refresh() {
  const tooLong = messageLength(question.value) > client.limits.maxMessageChars;
  send.disabled = blocked !== null || tooLong;
  send.hidden = turning; // Stop takes Send's place during a turn, a message's or a job offer's
  stop.hidden = !turning;
  // The job-offer view: Analyze under the form, "Analyze another offer" under a report; Stop takes
  // the place of either during a turn. A report kept behind the form stays one click away.
  analyse.disabled = blocked !== null;
  analyse.hidden = turning || showing !== "form";
  another.hidden = showing !== "report";
  another.classList.toggle("is-aside", turning); // beside Stop
  offerStop.hidden = !turning;
  toReport.hidden = showing !== "form" || report.childNodes.length === 0;
  fresh.disabled = turning;
  topic.disabled = turning; // a turn keeps the scope it was sent in
  // Nothing to start again: the current conversation shows nothing and the client follows none.
  fresh.hidden = current().length === 0 && client.conversation === null;
  showStarted();
  log.setAttribute("aria-busy", String(turning));
  panel.classList.toggle("is-busy", turning);
  panel.classList.toggle("is-blocked", blocked !== null); // the closable notices step aside
  showPrivacy();
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
  if (document.activeElement?.closest("[data-askfolio-placard]:not(.askfolio__placard--report)")) {
    fieldOf(view).focus(); // the notice it was in stepped aside
  }
}

function unblock() {
  clearTimeout(timer);
  const inNotice = notice.contains(document.activeElement);
  blocked = null;
  notice.hidden = true;
  challenge.hidden = false; // in the layout again before the next session is needed
  refresh();
  if (inNotice) fieldOf(view).focus();
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

/** The PDF limits under the file control: the service's defaults, then the session's. */
function showLimits() {
  const { jobOfferMaxPdfBytes, jobOfferMaxPdfPages } = client.limits;
  offerHint.textContent = TEXT.offerHint(jobOfferMaxPdfBytes, jobOfferMaxPdfPages);
}

/** What a client-side check refused, in a line (`""`: nothing to say, an empty message). */
function inputText({ code, limit }) {
  if (code === "invalid_scope") return TEXT.badTopic;
  if (code === "message_too_long") return TEXT.tooLong(limit);
  if (code === "offer_text_too_short") return TEXT.offerShort;
  if (code === "offer_text_too_long") return TEXT.offerLong(limit);
  if (code === "offer_pdf_type") return TEXT.offerType;
  if (code === "offer_pdf_too_large") return TEXT.offerSize(limit);
  return "";
}

/**
 * Every failure, as something the visitor sees. `say` writes a one-line message: a note in the
 * log, or the inline message of the job-offer form; `words` are a job offer's own words.
 */
function fail(error, say, words = TEXT) {
  switch (error.kind) {
    case "aborted":
      return say(words.stopped);
    case "busy":
      return; // Send and Analyze are replaced by Stop during a turn
    case "input":
      return say(inputText(error));
    case "turnstile":
      return say(words.humanCheck);
    case "unavailable":
      return error.status === "budget_exhausted"
        ? block(words.budget, Date.now() + 3_600_000)
        : block(words.unavailable, Date.now() + 60_000);
    case "network":
      return say(words.network);
    case "dropped":
    case "stream":
      return say(words.interrupted);
    case "http":
      if (error.code === "rate_limited") {
        // Three causes, one code: a short Retry-After is a stream still closing (after a stop).
        const seconds = error.retryAfter ?? 60;
        return seconds <= 5 ? pause(words.closing, seconds, false) : pause(words.limited, seconds);
      }
      if (error.code === "budget_exhausted") {
        return block(words.budget, Date.now() + (error.retryAfter ?? 3600) * 1000);
      }
      if (error.code === "service_unavailable") {
        return block(words.unavailable, Date.now() + 60_000);
      }
      if (error.code === "conversation_limit") {
        client.newConversation();
        writeLog(null); // its stored copy goes with it; it stays in view until the next send
        full = true; // folds it, with this note
        return say(words.full);
      }
      if (error.code === "invalid_scope") return say(words.badTopic);
      return say(words.generic);
  }
}

// ─── The panel: open, close, and the mode that fits the viewport ─────────────────────────────

/**
 * Opens the panel; `focus` is where the focus goes, `undefined` for the default target, `null`
 * for the caller to move it.
 */
function openPanel(focus) {
  if (panel.open) return;
  if (WIDE.matches) {
    panel.show();
    // At the height its content needs from the start, without growing in view; measured before
    // the first frame, once the caller's changes are in (a topic button folds a conversation).
    opening = true;
    requestAnimationFrame(() => {
      const end = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
      grow(true);
      opening = false;
      if (end && view === "chat") log.scrollTop = log.scrollHeight; // the latest messages still
    });
  } else {
    fitSheet();
    panel.showModal(); // the browser makes the page inert, traps the focus and handles Escape
  }
  launcher.hidden = true;
  giveScroll();
  scrollLog();
  if (focus !== undefined) focus?.focus();
  // On a wide screen, straight to the view's field. On a narrow one, focusing the field would
  // raise the virtual keyboard over the panel at once: the heading takes the focus instead.
  else if (panel.matches(":modal")) heading.focus();
  else fieldOf(view).focus();
}

/** The latest messages in view, once, the first time the log can scroll (open and shown). */
function scrollLog() {
  if (scrolled || !panel.open || view !== "chat") return;
  scrolled = true;
  log.scrollTop = log.scrollHeight;
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
  grown = 0; // the next opening starts again from the content it finds
  panel.style.removeProperty("--askfolio-grown");
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

/**
 * The floating panel takes the height its content needs: CSS keeps it between a base height and
 * the room under the page's top bar (its max-height), its bottom edge fixed, from
 * `--askfolio-grown`. The need is the panel's height plus what its scrollers in view hold beyond
 * their own height, up to that room: once the content fits or the room is reached, a new
 * measurement changes nothing, so that the observers below settle. It never shrinks while the
 * panel stays open, so that a tab switched, a notice closed or a conversation
 * folded never makes its top edge bounce; the next opening starts again from its content. Growth
 * is instant during a turn (CSS), so that a streamed answer is followed line by line, and when
 * `instant` (by default while the panel is opening); otherwise CSS eases it.
 */
function grow(instant = opening) {
  if (!panel.open || panel.matches(":modal")) return;
  let more = 0;
  for (const scroller of [main, log, empty, sheet]) {
    if (scroller.getClientRects().length > 0) more += scroller.scrollHeight - scroller.clientHeight;
  }
  const room = parseFloat(getComputedStyle(panel).maxHeight);
  const needed = Math.min(Math.ceil(panel.offsetHeight + more), Math.floor(room));
  if (more < 1 || needed <= grown) return;
  grown = needed;
  if (instant) panel.classList.add("is-sizing");
  panel.style.setProperty("--askfolio-grown", `${grown}px`);
  if (instant) {
    void panel.offsetHeight; // the new height is laid out before the transition comes back
    panel.classList.remove("is-sizing");
  }
}

// Anything that may need more room, outside a turn's own drawing (which grows at once): an entry
// folded or unfolded, a report, a view shown (mutations in the views); what resizes the room under
// the header or the composer from elsewhere: the challenge or a notice in the strip, the question
// field growing, the layout for limited heights (sizes); the window; and once an eased growth has
// ended, what it left to show. Once per frame.
let sizing = 0;
const queueGrow = () => {
  sizing ||= requestAnimationFrame(() => {
    sizing = 0;
    grow();
  });
};
new MutationObserver(queueGrow).observe(main, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["open", "hidden"],
});
const growSizes = new ResizeObserver(queueGrow);
for (const node of [main, form, question, panel.querySelector(".askfolio__signal"), ...starters]) {
  growSizes.observe(node);
}
panel.addEventListener("transitionend", (event) => {
  if (event.target === panel && event.propertyName === "height") queueGrow();
});
window.addEventListener("resize", queueGrow);

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

// ─── The two views: tabs in the header, each view keeping its state while the other is shown ──

/** Where the focus goes in a view: its field, or what stands for it. */
function fieldOf(name) {
  if (name === "chat") return question;
  if (showing === "report") return report;
  return offerText.disabled ? $("askfolio-offer-remove") : offerText; // a file replaces the text
}

/** Shows the view `next`, where it was scrolled. The focus stays where it is (on the tab). */
function showView(next) {
  if (next === view) return;
  view = next;
  for (const tab of tabs) {
    const selected = tab.getAttribute("aria-controls") === views[next].id;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1; // roving tabindex: Tab enters the list on the selected tab
  }
  views.chat.hidden = next !== "chat";
  views.offer.hidden = next !== "offer";
  if (next === "offer") tabMark.hidden = true; // the report it pointed to is in view
  showPrivacy();
  giveScroll();
  scrollLog();
}

// A hidden scroller reads as unscrolled, and not every browser gives its position back: each
// view's position is kept while it is shown, and given back when it is shown again. The form and
// the report share one scroller, the sheet.
log.addEventListener("scroll", () => {
  if (view === "chat" && panel.open) scrolls.chat = log.scrollTop;
}, { passive: true });

sheet.addEventListener("scroll", () => {
  if (view === "offer" && panel.open) scrolls[showing] = sheet.scrollTop;
}, { passive: true });

function giveScroll() {
  if (!panel.open) return; // given when the panel opens
  if (view === "offer") sheet.scrollTop = scrolls[showing];
  else if (scrolls.chat !== null) log.scrollTop = scrolls.chat;
}

// Tabs: a click selects; the arrow keys, Home and End move to a tab and select it (two views of a
// panel already drawn: selecting on focus costs nothing).
for (const tab of tabs) {
  const name = tab.getAttribute("aria-controls") === views.offer.id ? "offer" : "chat";
  tab.addEventListener("click", () => showView(name));
}

tabs[0].parentElement.addEventListener("keydown", (event) => {
  const at = tabs.indexOf(document.activeElement);
  if (at === -1 || event.altKey || event.ctrlKey || event.metaKey) return;
  const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  const tab = tabs[(to + tabs.length) % tabs.length];
  tab.focus();
  tab.click();
});

// The page's entry point into the job-offer view (data-askfolio-view): opens the panel on that
// view; the focus goes back to it when the panel is closed.
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-askfolio-view]");
  if (button === null || button === undefined || button.hidden) return;
  opener = button;
  showView(button.dataset.askfolioView === "offer" ? "offer" : "chat");
  if (panel.open) fieldOf(view).focus();
  else openPanel();
});

// ─── Topics: the control in the conversation view, the buttons on the page, the suggestions ───

/** The topic's name, as the topic control's option writes it in the page's language. */
function topicName(value) {
  return [...topic.options].find((option) => option.value === value)?.text ?? value;
}

/** The invitation and the suggested questions that fit the topic, for the empty conversation. */
function showStarter() {
  const kind = scope.startsWith("project:") ? "project" : scope;
  for (const starter of starters) starter.hidden = starter.dataset.askfolioStarter !== kind;
  edgeEmpty();
}

/** On a short panel the empty conversation scrolls inside itself: a fade on each edge with more. */
function edgeEmpty() {
  const { scrollTop, scrollHeight, clientHeight } = empty;
  empty.classList.toggle("is-above", scrollTop > 1);
  empty.classList.toggle("is-below", scrollTop + clientHeight < scrollHeight - 1);
}

empty.addEventListener("scroll", edgeEmpty, { passive: true });
// The panel opening or resized, a notice closing, the invitation's lines rewrapping.
const emptySizes = new ResizeObserver(edgeEmpty);
for (const node of [empty, ...empty.querySelectorAll(".askfolio__starter")]) emptySizes.observe(node);

/**
 * Switches to the topic `next`. A new topic ends the conversation now, so that coming back to the
 * previous topic never continues it (the client alone would continue a conversation whose scope
 * matches again): the log folds it, and the new topic's invitation shows under it. A topic
 * button's draft the visitor left untouched goes with its topic. During a turn, the change waits
 * for the turn's end: the turn keeps the scope it was sent in.
 */
function setTopic(next) {
  if (turning) {
    pending = next === scope ? null : next;
    return;
  }
  topic.value = next;
  if (next === scope) return;
  const shown = current().length > 0;
  client.newConversation();
  fold(); // named after the topic it was about
  scope = next;
  showStarter();
  if (drafted !== null && drafted !== next) {
    question.value = "";
    drafted = null;
    count();
  }
  if (shown) startOver();
  refresh();
}

/** After a conversation was folded: the latest folded ones in view, and the change announced. */
function startOver() {
  log.scrollTop = log.scrollHeight;
  announce(TEXT.newTopic(topicName(scope)));
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
  showView("chat");
  openPanel(null); // open first, so that a new conversation is announced from the panel
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
  if (result.ok) limitsChanged(); // the session's limits replace the service's defaults
  else if (result.error.kind !== "aborted" && !turning) fail(result.error, note);
});

/**
 * The question field grows with the draft up to the room the view leaves it: the room under the
 * header (less a blocking notice or a challenge in the strip above) minus the topic row, the
 * smallest body and the rest of the composer, its notice and its action row included. Beyond it,
 * the field scrolls inside itself, and Send stays in the panel. A panel too short for even that
 * (a phone in landscape) keeps the field at its smallest and scrolls as a whole.
 */
function fitField() {
  if (!panel.open || view !== "chat") return;
  const body = Math.min(120, main.clientHeight * 0.1); // a share kept for the log above
  const rest = topic.parentElement.offsetHeight + body + form.offsetHeight - question.offsetHeight;
  const room = main.clientHeight - rest;
  question.style.setProperty("--askfolio-room", `${Math.floor(room)}px`);
}

// The room changes with the panel's size, the strip's notice or challenge, a notice closing, the
// view shown; the field's own growth leaves it as it is.
const fieldRoom = new ResizeObserver(fitField);
fieldRoom.observe(main);
fieldRoom.observe(form);

function limitsChanged() {
  count();
  showLimits();
}

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

// Stop, in either view, ends the turn in flight, a message's or a job offer's.
stop.addEventListener("click", () => client.stop());
offerStop.addEventListener("click", () => client.stop());

/**
 * After a turn, the Stop button the focus was on is hidden again: the focus goes back to the
 * button it replaced, or to the view's field when a notice disabled that button.
 */
function leaveStop(active) {
  if (active === stop) (send.disabled ? question : send).focus();
  else if (active === offerStop) {
    (analyse.hidden || analyse.disabled ? fieldOf("offer") : analyse).focus();
  }
}

// "New conversation" folds the current one, as a new topic does, and keeps the topic.
fresh.addEventListener("click", () => {
  const shown = current().length > 0;
  client.newConversation();
  fold(); // its stored copy cleared too
  refresh(); // hides this button: the focus moves to the question
  if (shown) startOver();
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
  if (full) fold(); // the conversation that reached its maximum length: this message starts anew
  const sent = bubble("visitor", asked);
  const answer = bubble("assistant");
  grow(true); // a turn's growth is instant, from its first line
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
      used("chat");
      setStatus("");
      cancelAnimationFrame(frame);
      draw = () => {
        const following = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
        answer.replaceChildren(renderMarkdown(text));
        grow(); // the floating panel first, up to its full height; then the log scrolls
        if (following) reveal(sent); // until the question reaches the top; never once scrolled
      };
      if (isFinal) {
        final = true;
        draw();
        draw = null;
      } else frame = requestAnimationFrame(draw);
    },
    onProgress: (progress) => {
      used("chat");
      setStatus(progressText(progress), progress.stage);
    },
    // Sent again in a new conversation: what came before this question is the previous one.
    onConversationExpired: () => {
      const items = current();
      fold(items.slice(0, Math.max(0, items.indexOf(sent))));
      note(TEXT.expired, answer);
    },
  });
  cancelAnimationFrame(frame); // no late frame: what streamed is drawn now, above any notice
  draw?.();
  const active = document.activeElement;
  turning = false;
  setStatus("");
  limitsChanged(); // the send may have opened or renewed the session: its limits apply
  if (result.ok) {
    used("chat");
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
  if (!panel.contains(document.activeElement)) leaveStop(active); // once the result is drawn
});

// ─── A job offer ──────────────────────────────────────────────────────────────────────────────

// Refusals the visitor must act on: the offer cannot work as it is; a file is dropped.
const REFUSED_OFFER = {
  payload_too_large: (pdf) =>
    pdf
      ? TEXT.offerSize(client.limits.jobOfferMaxPdfBytes)
      : TEXT.offerLong(client.limits.jobOfferMaxTextChars),
  unsupported_media_type: () => TEXT.offerType,
  document_unreadable: () => TEXT.offerUnreadable,
};

/** The chosen file, under the file control; a file replaces the text, which waits disabled. */
function showFile() {
  const file = offerPdf.files[0];
  chosen.hidden = file === undefined;
  offerText.disabled = file !== undefined;
  if (file === undefined) return;
  $("askfolio-offer-file").textContent = `${file.name}, ${TEXT.fileSize(file.size)}`;
}

function dropFile() {
  offerPdf.value = "";
  showFile();
}

/**
 * An offer message under the form, announced when it appears (`""` clears it), and scrolled into
 * view: it lands under the fields, which may be scrolled out of the sheet's view.
 */
function offerProblem(text, reveal = true) {
  offerError.textContent = text;
  if (text === "") return;
  announce(text);
  if (reveal && !offerForm.hidden) offerError.scrollIntoView({ block: "nearest" });
}

/** Shows the form or the report in the job-offer view, each where it was scrolled. */
function show(next) {
  if (next === showing) return;
  showing = next;
  offerForm.hidden = next !== "form";
  report.hidden = next !== "report";
  showPrivacy(); // the form's notice leaves with the form
  if (view === "offer") giveScroll();
  refresh();
}

offerPdf.addEventListener("change", async () => {
  const file = offerPdf.files[0];
  showFile();
  const problem = file === undefined ? null : await client.checkOffer({ pdf: file });
  if (offerPdf.files[0] !== file) return; // another file was picked meanwhile
  if (problem !== null) dropFile();
  offerProblem(problem === null ? "" : inputText(problem));
});

$("askfolio-offer-remove").addEventListener("click", () => {
  dropFile();
  offerProblem("");
  offerPdf.focus(); // the button is gone: the file control, to pick another, or Tab to the text
});

offerText.addEventListener("input", () => {
  const max = client.limits.jobOfferMaxTextChars;
  const text = offerTextLength(offerText.value) > max ? TEXT.offerLong(max) : "";
  if (text !== offerError.textContent) offerProblem(text, false); // once, not at every key; the
  // field, where the visitor is typing, stays where it is
});

// Where the visitor last clicked or moved the focus: a report takes the focus only from the panel.
for (const type of ["pointerdown", "focusin"]) {
  document.addEventListener(type, (event) => {
    within = panel.contains(event.target);
  });
}

// As for the question: a session is opened (Turnstile runs) while the visitor pastes or picks.
for (const field of [offerText, offerPdf]) {
  field.addEventListener("focus", async () => {
    await recheck();
    if (client.session !== null || blocked !== null) return;
    const result = await client.connect();
    if (result.ok) limitsChanged();
    else if (result.error.kind !== "aborted" && !turning) {
      fail(result.error, offerProblem, OFFER_TEXT);
    }
  });
}

// "Analyze another offer" leads back to the form; the report stays one click away ("See the
// report") until the next one replaces it.
another.addEventListener("click", () => {
  show("form");
  fieldOf("offer").focus();
});

toReport.addEventListener("click", () => {
  show("report");
  report.focus({ preventScroll: true }); // where the visitor left it
});

/** Gives back a turn claimed for an offer that was not sent. */
function release() {
  turning = false;
  refresh();
}

offerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (turning) return;
  // The turn is claimed before anything is awaited, so that a second activation (a double
  // click while the file is read) is ignored instead of sending the offer twice. The busy state
  // is drawn only once the offer passed its checks.
  turning = true;
  if (blocked !== null) await recheck(); // at once before the notice's time: no request
  if (blocked !== null) return release();
  const file = offerPdf.files[0];
  const text = offerText.value;
  const offer = file === undefined ? { text } : { pdf: file };
  // Checked first, so that a refused offer shows its message without a busy state.
  const problem = await client.checkOffer(offer);
  if (problem !== null) {
    release();
    if (file !== undefined && offerPdf.files[0] === file) dropFile();
    return offerProblem(inputText(problem));
  }
  if (blocked !== null) return release(); // a notice appeared while the file was read
  offerProblem("");
  const fromAnalyse = document.activeElement === analyse;
  spoken = new Set();
  refresh();
  if (fromAnalyse) offerStop.focus(); // Analyze is hidden: the focus goes to Stop, in its place
  report.setAttribute("aria-busy", "true");
  setStatus(TEXT.readingOffer);
  const result = await client.sendOffer({
    ...offer, // checked again by the client before it is sent
    onProgress: (progress) => {
      used("offer");
      setStatus(progressText(progress, OFFER_TEXT), progress.stage);
    },
  });
  // Where the visitor is, read while Stop is still shown (hiding it would move a focus on it to
  // <body>): a focus on an offer field means they are working on the next offer, empty or not.
  // A focus on <body> still counts as in the panel when the visitor's last click or focus was
  // there: some browsers give a clicked button no focus, so Analyze leaves it on <body>.
  const active = document.activeElement;
  const inPanel = panel.contains(active) || (active === document.body && within);
  const working = offerForm.contains(active) && active.matches("textarea, input");
  const typing = working || (active?.matches?.("textarea, input") && active.value !== "");
  turning = false;
  setStatus("");
  report.setAttribute("aria-busy", "false");
  // The fields stayed editable: drop only what was sent, never what the visitor typed or picked
  // during the analysis.
  const sentFile = file !== undefined && offerPdf.files[0] === file;
  if (result.ok) {
    used("offer");
    if (file === undefined && offerText.value === text) offerText.value = ""; // the offer sent
    if (sentFile) dropFile(); // leaves the page; the service stores none either
    showReport(result.value);
    scrolls.report = 0; // a new report is read from its top
    // The report replaces the form, unless the visitor is working in it: then it waits behind
    // "See the report", and its summary is announced either way.
    if (!working) show("report");
    if (showing === "report" && view === "offer") giveScroll(); // a report replacing a report
    limitsChanged(); // as after a message: the session's limits apply
    // The focus moves to the report only from inside the panel: never from the page around a
    // floating panel, nor from a field the visitor is typing in.
    if (view !== "offer") tabMark.hidden = false;
    else if (panel.open && showing === "report" && !typing && inPanel) {
      report.focus({ preventScroll: true });
    }
  } else {
    const lost = report.contains(document.activeElement); // the report, about to be hidden
    show("form"); // the message is under the form
    limitsChanged();
    if (lost) (file === undefined ? offerText : offerPdf).focus(); // the field that was sent
    const refused = result.error.kind === "http" ? REFUSED_OFFER[result.error.code] : undefined;
    if (refused === undefined) fail(result.error, offerProblem, OFFER_TEXT);
    else {
      if (sentFile) dropFile();
      offerProblem(refused(file !== undefined));
    }
  }
  if (pending !== null) {
    setTopic(pending); // a topic button pressed during the analysis
    pending = null;
  }
  if (!panel.contains(document.activeElement)) leaveStop(active); // unless the report took it
});

/** Where evidence was found, named as the topic control names it: the background, or a project. */
function sourceName(projectId) {
  const value = projectId === "profile" ? "profile" : `project:${projectId}`;
  const name = topicName(value);
  return name === value ? projectId : name; // a project the page does not list: its id
}

/**
 * The report, as text only (textContent, never innerHTML; no Markdown): its disclaimer first,
 * until the visitor closes it (nothing else does), the summary, the requirements (required ones
 * first) with their match and evidence, the gaps, the questions, and the note that a long offer
 * was cut. The report is in the offer's language; the words this script adds are in the page's,
 * and say so.
 */
function showReport(outcome) {
  if (outcome.kind === "refused") {
    report.removeAttribute("lang"); // the service's fixed refusal, whose language is not given
    report.replaceChildren(element("p", outcome.text, "askfolio__refusal"));
    return announce(outcome.text);
  }
  const { disclaimer, summary, requirements, gaps, questionsForCandidate, input } = outcome.report;
  const said = (tag, text, className) =>
    Object.assign(element(tag, text, className), { lang: document.documentElement.lang });
  const list = (items, className) => {
    const node = element("ul", undefined, className);
    for (const item of items) node.append(item instanceof Node ? item : element("li", item));
    return node;
  };
  const requirement = (item) => {
    const row = element("li", undefined, `askfolio__requirement is-${item.match}`);
    const meter = element("span", undefined, "askfolio__meter");
    meter.setAttribute("aria-hidden", "true"); // the words next to it say the same
    meter.append(element("i"), element("i"), element("i"));
    row.append(
      meter,
      element("p", item.requirement, "askfolio__need"),
      said("p", TEXT.match[item.match], "askfolio__match"),
    );
    const evidence = item.evidence.map((proof) => {
      const line = element("li");
      const source = said("span", sourceName(proof.projectId), "askfolio__source");
      line.append(source, " ", proof.description);
      if (proof.files?.length) line.append(list(proof.files, "askfolio__files"));
      return line;
    });
    if (evidence.length > 0) row.append(list(evidence, "askfolio__evidence"));
    return row;
  };
  const groups = ["must", "nice"].flatMap((importance) => {
    const items = requirements.filter((item) => item.importance === importance);
    if (items.length === 0) return [];
    const rows = list(items.map(requirement), "askfolio__requirements");
    return [said("h4", TEXT.importance[importance]), rows];
  });
  report.lang = outcome.report.language; // the report is written in the offer's language
  report.replaceChildren(
    ...(closed.has("report") ? [] : [reportNotice(disclaimer, outcome.report.language)]),
    ...(input.truncated ? [said("p", TEXT.truncated, "askfolio__truncated")] : []),
    said("h3", TEXT.summary),
    element("p", summary, "askfolio__summary"),
    said("h3", TEXT.requirements),
    ...groups,
    ...(gaps.length > 0 ? [said("h3", TEXT.gaps), list(gaps, "askfolio__gaps")] : []),
    ...(questionsForCandidate.length > 0
      ? [said("h3", TEXT.questions), list(questionsForCandidate, "askfolio__asks")]
      : []),
  );
  announce(summary);
}
