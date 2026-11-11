// Replaces Cloudflare's Turnstile script with a stub, so the e2e suite never depends on Cloudflare.
// The stub widget issues `stub~<action>~<hostname>~<n>`: the e2e API's siteverify stub
// (apps/api/test/support/turnstile-stub.ts) accepts each such token once and reports that action
// and hostname, so a wrong `action`, a wrong host or a reused token fails as with Cloudflare.
import { test as base, type Page } from '@playwright/test';

export const SITE_KEY = 'e2e-site-key';
/** The token the stub issues after `nextTokenBad`; the siteverify stub refuses it. */
export const BAD_TOKEN = 'refused-by-stub';
// Like Cloudflare, the stub hands a token to the page asynchronously. Tests wait for
// `state.delivered`, never for time, so any value here must keep them green.
const DELIVERY_MS = 20;

const WIDGET_SCRIPT = `(() => {
  const widgets = new Map();
  const state = { renders: [], issued: 0, nextBad: false, delivered: null };
  const issue = (id) => {
    const w = widgets.get(id);
    if (!w) return;
    state.issued += 1;
    w.token = state.nextBad ? '${BAD_TOKEN}' : 'stub~' + w.opts.action + '~' + location.hostname + '~' + state.issued + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    state.nextBad = false;
    const token = w.token;
    setTimeout(() => {
      if (w.opts.callback) w.opts.callback(token);
      state.delivered = token;
    }, ${DELIVERY_MS});
  };
  const each = (name) => widgets.forEach((w) => w.opts[name] && w.opts[name]());
  window.__turnstile = {
    state,
    expire: () => each('expired-callback'),
    error: () => each('error-callback'),
    issueAll: () => widgets.forEach((_, id) => issue(id)),
  };
  window.turnstile = {
    render(el, opts) {
      const id = 'w' + (state.renders.length + 1);
      widgets.set(id, { opts });
      state.renders.push({ sitekey: opts.sitekey, action: opts.action, language: opts.language });
      issue(id);
      return id;
    },
    reset(id) { issue(id); },
    remove(id) { widgets.delete(id); },
    getResponse(id) { return widgets.get(id) && widgets.get(id).token; },
  };
})();`;

export type WidgetState = {
  renders: { sitekey: string; action: string; language: string }[];
  issued: number;
  /** The last token handed to the page's callback. */
  delivered: string | null;
};

/** `test` with the stub widget script routed in for every page. */
export const test = base.extend<{ turnstileStub: void }>({
  turnstileStub: [
    async ({ context }, use) => {
      await context.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: WIDGET_SCRIPT }),
      );
      await use();
    },
    { auto: true },
  ],
});

/** The stub widget's state; empty until the script has loaded. */
export const widgetState = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __turnstile?: { state: WidgetState } }).__turnstile?.state ?? { renders: [], issued: 0, delivered: null },
  );

/** The next token the widget issues is one the siteverify stub refuses. */
export const nextTokenBad = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __turnstile: { state: { nextBad: boolean } } }).__turnstile.state.nextBad = true;
  });

export const widgetCall = (page: Page, name: 'expire' | 'error' | 'issueAll') =>
  page.evaluate((fn) => (window as unknown as { __turnstile: Record<string, () => void> }).__turnstile[fn]?.(), name);
