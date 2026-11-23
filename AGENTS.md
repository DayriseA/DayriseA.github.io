# AGENTS CONTEXT & GUIDELINES

## Miscellaneous

- Human–AI interactions may use any language (french, english, etc...), but all project artifacts (including code, comments, documentation, and other persisted content) must be written in English.

## The portfolio assistant (Askfolio)

The site has its own chat interface on the [Askfolio](https://github.com/DayriseA/askfolio) headless client. Askfolio's `docs/14-headless-client.md` is the reference for everything below.

- **Files.** `assets/askfolio/askfolio-client.js` and `askfolio-markdown.js` (with their source maps) are copied from a build of Askfolio and pinned in `askfolio-client.js.version`: never edit them. To upgrade, repeat section 2 of the guide and replace the files and the pin together. The site's own code is `assets/askfolio/assistant.js` and `assistant.css`, plus the launcher, the `<dialog id="askfolio">` and the `data-askfolio-scope` / `data-askfolio-view` buttons in `index.html` and `fr/index.html`. The two pages hold the same markup, each in its language: change them together.
- **Service.** `SERVICE_URL` at the top of `assistant.js`: the local service (`http://localhost:8787`) on `localhost`, production (`https://askfolio-dayrise.fly.dev`) elsewhere. Production only accepts the site's real origin, so local work needs a local service (Askfolio's `deploy/docker-compose.yml`) and a page served over `http://` from an origin listed in its `ASKFOLIO_ALLOWED_ORIGINS`. Questions and job-offer analyses are paid model calls.
- **Rules that must keep holding.** Nothing of the assistant shows unless the service answers its health check, and the page works without it. Answers are drawn with `renderMarkdown`, every other string from the service with `textContent`, never `innerHTML`. The AI disclosure stays visible in the panel's fixed header.
- **Topics.** The project ids in `data-askfolio-scope` and in the topic `<select>` are those of the snapshot the service holds (`checkout-surge`, `social-media-coach`, `oc-lettings`, `epicevents-crm`, `gudlift-registration`, `softdesk-api`). Adding, removing or renaming a project means updating both pages.
- **Privacy pages.** `privacy/index.html` and `fr/confidentialite/index.html` describe this deployment: its providers, retention and browser storage. Update them when the deployment changes, for example a new provider, another retention period, new browser storage, or a `private` project (its answers go through OpenAI's judge, which the pages do not mention today).
