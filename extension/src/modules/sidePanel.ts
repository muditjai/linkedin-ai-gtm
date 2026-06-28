/**
 * Side Panel - AI reply drafting + top-15 thread list + context sources.
 *
 * Layout (3-column grid in `fullpage.html`):
 *  - Left:    existing contact list (rendered by `modules/messages.ts`)
 *  - Center:  existing thread view (rendered by `modules/messages.ts`)
 *  - Right:   THIS module's side panel
 *
 * The panel's four regions:
 *  1. **Top-15 thread list**  - `GET /api/threads?limit=15` (descending by
 *     `lastScrapedAt`). Click a row to load that thread's context.
 *  2. **Context**  - last 10 inbound messages for the selected thread
 *     (`GET /api/messages?threadUrn=...`). Shows up to 10 with a
 *     "Generating context..." placeholder while loading.
 *  3. **Draft + feedback**  - a `<textarea>` for the AI draft, a
 *     "Regenerate" button that calls `POST /api/draft`, and thumbs
 *     up/down + comment that POSTs to `/api/feedback`.
 *  4. **Context sources**  - per-thread enrichment (LinkedIn profile,
 *     company, email history, common connections, social posts,
 *     interests, prior feedback). Sourced from
 *     `GET /api/threads/:urn/context`.
 *
 * Sync with the Messages tab: when the user picks a conversation in
 * the centre pane, the Messages module dispatches
 * `linkedin-ai:thread-selected` on `window`. The panel listens and
 * updates its selection + auto-loads the context / draft.
 *
 * No-bug safeguards:
 *  - Empty-state placeholders so the panel never looks broken.
 *  - Disabled state on the Regenerate button while in-flight.
 *  - Errors degrade to a small error text; the user can still type
 *    their own draft manually.
 */

import type {
  ConversationMessage,
  ContextSource,
  ContextSourcesResponse,
} from '../types.js';
import {
  THREAD_SELECTED_EVENT,
  readThreadSelectedDetail,
} from '../types.js';
import {
  getTopThreads,
  getMessages,
  createDraft,
  saveFeedback,
  getContextSources,
  type BackendThread,
} from './api.js';

interface PanelState {
  selectedUrn: string | null;
  selectedName: string;
  threads: BackendThread[];
  context: ConversationMessage[];
  draft: string;
  isGeneratingDraft: boolean;
  contextLoading: boolean;
  contextSources: ContextSourcesResponse | null;
  contextSourcesLoading: boolean;
  error: string;
}

let state: PanelState = {
  selectedUrn: null,
  selectedName: '',
  threads: [],
  context: [],
  draft: '',
  isGeneratingDraft: false,
  contextLoading: false,
  contextSources: null,
  contextSourcesLoading: false,
  error: '',
};

let mounted = false;

/**
 * Mount the side panel. Safe to call multiple times; subsequent calls
 * just refresh the contents.
 *
 * The `#sidePanel` element in `fullpage.html` ships with the `hidden`
 * class so the page doesn't flash a half-rendered panel during init.
 * Once we have content to show we strip that class so the panel
 * actually appears in the messages tab.
 */
export async function mountSidePanel(): Promise<void> {
  const root = document.getElementById('sidePanel');
  if (!root) {
    // Page hasn't loaded the side-panel slot yet - caller can retry.
    return;
  }
  // Show the panel container (the column itself) before rendering the
  // inner sections so the layout doesn't collapse to zero width.
  root.classList.remove('hidden');
  root.classList.add('flex');
  mounted = true;

  // Wire the cross-component event listener exactly once.
  wireThreadSelectedListener();

  await refreshThreadList();
  // The first render() above populates the panel (with an empty-state
  // message if the backend is unreachable). Now that we have DOM in
  // place, drop the `hidden` class so the panel actually shows up.
  // This is a no-op on subsequent calls.
  root.classList.remove('hidden');
}

export function isSidePanelMounted(): boolean {
  return mounted;
}

/**
 * Re-fetch the top-15 thread list from the backend and re-render the
 * panel. Called on mount and on demand (e.g. after a Scrape All).
 */
export async function refreshThreadList(): Promise<void> {
  if (!mounted) return;
  const root = document.getElementById('sidePanel');
  if (!root) return;
  state.threads = await getTopThreads(15);
  render(root);
}

function render(root: HTMLElement): void {
  // Use a DocumentFragment so we only trigger one reflow on re-render.
  const fragment = document.createDocumentFragment();
  fragment.appendChild(renderHeader());
  fragment.appendChild(renderThreadList());
  fragment.appendChild(renderContext());
  fragment.appendChild(renderContextSources());
  fragment.appendChild(renderDraftArea());
  root.replaceChildren(fragment);
}

function renderHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className =
    'border-b border-gray-200 px-4 py-3 flex items-center justify-between';
  const left = document.createElement('div');
  left.className = 'flex flex-col';
  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold text-gray-700';
  title.textContent = state.selectedName
    ? `AI Reply - ${truncate(state.selectedName, 24)}`
    : 'AI Reply Panel';
  left.appendChild(title);
  const subtitle = document.createElement('span');
  subtitle.className = 'text-xs text-gray-500';
  subtitle.textContent = state.selectedUrn
    ? `Thread ${truncate(state.selectedUrn, 20)}`
    : 'Top 15 threads + AI draft + context';
  left.appendChild(subtitle);
  header.appendChild(left);

  const refreshBtn = document.createElement('button');
  refreshBtn.className =
    'rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Re-fetch the top 15 threads from the backend';
  refreshBtn.addEventListener('click', () => {
    void refreshThreadList();
  });
  header.appendChild(refreshBtn);
  return header;
}

function renderThreadList(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'overflow-y-auto border-b border-gray-200';
  container.style.maxHeight = '24%';
  if (state.threads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'p-4 text-center text-xs text-gray-500';
    empty.textContent =
      'No threads yet. Run Scrape All once to populate the backend, then refresh this panel.';
    container.appendChild(empty);
    return container;
  }
  const list = document.createElement('ul');
  list.className = 'divide-y divide-gray-100';
  state.threads.forEach((t) => {
    list.appendChild(renderThreadRow(t));
  });
  container.appendChild(list);
  return container;
}

function renderThreadRow(t: BackendThread): HTMLElement {
  const li = document.createElement('li');
  const isSelected = t.urn === state.selectedUrn;
  li.className = [
    'flex flex-col px-4 py-2 cursor-pointer hover:bg-gray-50',
    isSelected ? 'bg-brand-50' : '',
  ].join(' ');
  li.addEventListener('click', () => {
    void selectThread(t.urn, t.conversationName);
  });

  const top = document.createElement('div');
  top.className = 'flex items-center justify-between';
  const name = document.createElement('span');
  name.className = 'text-sm font-medium text-gray-800 truncate';
  name.textContent = t.conversationName;
  top.appendChild(name);

  if (t.lastMessageIsInbound) {
    const badge = document.createElement('span');
    badge.className = 'ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700';
    badge.textContent = 'Reply';
    badge.title = 'Inbound - a reply is owed';
    top.appendChild(badge);
  }
  li.appendChild(top);

  const preview = document.createElement('p');
  preview.className =
    'mt-1 text-xs text-gray-500 truncate';
  preview.textContent =
    t.lastInboundPreview || t.lastMessageTime || '(no messages)';
  li.appendChild(preview);

  return li;
}

function renderContext(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'p-3 border-b border-gray-200';
  container.style.maxHeight = '20%';
  container.style.overflowY = 'auto';

  const header = document.createElement('h4');
  header.className =
    'text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2';
  header.textContent = state.selectedUrn
    ? 'Context (last 10 inbound)'
    : 'Context';
  container.appendChild(header);

  if (!state.selectedUrn) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-gray-500';
    empty.textContent = 'Select a thread above to load its context.';
    container.appendChild(empty);
    return container;
  }

  if (state.contextLoading) {
    const loading = document.createElement('p');
    loading.className = 'text-xs text-gray-500 italic';
    loading.textContent = 'Loading context…';
    container.appendChild(loading);
    return container;
  }

  if (state.context.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-gray-500';
    empty.textContent = 'No messages on file yet for this thread.';
    container.appendChild(empty);
    return container;
  }

  state.context.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'mb-2 rounded border border-gray-100 bg-white p-2 text-xs';
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between text-gray-500';
    const sender = document.createElement('span');
    sender.className = 'font-semibold text-gray-700';
    sender.textContent = m.senderName;
    head.appendChild(sender);
    const ts = document.createElement('span');
    ts.textContent = m.timestamp ?? '';
    head.appendChild(ts);
    item.appendChild(head);
    const body = document.createElement('p');
    body.className = 'mt-1 whitespace-pre-wrap break-words text-gray-800';
    body.textContent = m.content;
    item.appendChild(body);
    container.appendChild(item);
  });
  return container;
}

/**
 * Per-thread context sources panel. Sourced from
 * `GET /api/threads/:urn/context`. Each "source" kind (LinkedIn
 * profile, company, email, etc.) gets a collapsible card so the panel
 * stays compact even when several sources are available.
 */
function renderContextSources(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'p-3 border-b border-gray-200';
  container.style.maxHeight = '28%';
  container.style.overflowY = 'auto';

  const header = document.createElement('h4');
  header.className =
    'text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center justify-between';
  const headerLabel = document.createElement('span');
  headerLabel.textContent = 'Context sources';
  header.appendChild(headerLabel);
  if (state.selectedUrn) {
    const refresh = document.createElement('button');
    refresh.className = 'text-[10px] text-brand-600 hover:underline';
    refresh.textContent = 'Reload';
    refresh.title = 'Re-fetch context sources from the backend';
    refresh.addEventListener('click', () => {
      const _urn = state.selectedUrn; if (_urn) void loadContextSources(_urn);
    });
    header.appendChild(refresh);
  }
  container.appendChild(header);

  if (!state.selectedUrn) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-gray-500';
    empty.textContent = 'Pick a thread to see enrichment sources.';
    container.appendChild(empty);
    return container;
  }

  if (state.contextSourcesLoading) {
    const loading = document.createElement('p');
    loading.className = 'text-xs text-gray-500 italic';
    loading.textContent = 'Loading context sources…';
    container.appendChild(loading);
    return container;
  }

  if (!state.contextSources || state.contextSources.sources.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-gray-500';
    empty.textContent = 'No context sources available for this thread.';
    container.appendChild(empty);
    return container;
  }

  state.contextSources.sources.forEach((src) => {
    container.appendChild(renderContextSource(src));
  });
  return container;
}

function renderContextSource(src: ContextSource): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mb-2 rounded border border-gray-100 bg-white p-2';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const label = document.createElement('span');
  label.className = 'text-xs font-semibold text-gray-700';
  label.textContent = labelForSource(src.kind);
  head.appendChild(label);
  const badge = document.createElement('span');
  badge.className = src.available
    ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700'
    : 'rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500';
  badge.textContent = src.available ? 'Live' : 'Stub';
  badge.title = src.available
    ? 'Source returned real data from the backend.'
    : 'No live data yet - showing a stub for the UI.';
  head.appendChild(badge);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'mt-1 text-xs text-gray-600';
  body.appendChild(renderContextSourceBody(src));
  card.appendChild(body);

  return card;
}

function renderContextSourceBody(src: ContextSource): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-1';
  switch (src.kind) {
    case 'linkedin_profile':
      wrapper.appendChild(makeKv('Name', src.name || 'Unknown'));
      wrapper.appendChild(makeKv('Headline', src.headline || '—'));
      wrapper.appendChild(makeKv('Location', src.location || '—'));
      if (src.profileUrl) {
        wrapper.appendChild(makeLinkKv('Profile', src.profileUrl));
      }
      break;
    case 'company':
      wrapper.appendChild(makeKv('Company', src.name || 'Unknown'));
      wrapper.appendChild(makeKv('Industry', src.industry || '—'));
      wrapper.appendChild(makeKv('Size', src.size || '—'));
      if (src.website) wrapper.appendChild(makeLinkKv('Website', src.website));
      if (src.description) {
        const desc = document.createElement('p');
        desc.className = 'mt-1 whitespace-pre-wrap break-words text-gray-700';
        desc.textContent = src.description;
        wrapper.appendChild(desc);
      }
      break;
    case 'email':
      if (!src.available || src.history.length === 0) {
        wrapper.appendChild(makePlaceholder('No email history yet.'));
      } else {
        src.history.slice(0, 3).forEach((h) => {
          const item = document.createElement('div');
          item.className = 'rounded bg-gray-50 p-1';
          const subj = document.createElement('div');
          subj.className = 'font-semibold text-gray-800';
          subj.textContent = h.subject || '(no subject)';
          item.appendChild(subj);
          const meta = document.createElement('div');
          meta.className = 'text-[10px] text-gray-500';
          meta.textContent = `${h.from} • ${h.sentAt}`;
          item.appendChild(meta);
          const snip = document.createElement('div');
          snip.className = 'mt-0.5 whitespace-pre-wrap break-words';
          snip.textContent = h.snippet;
          item.appendChild(snip);
          wrapper.appendChild(item);
        });
      }
      break;
    case 'common_connections':
      if (!src.available || src.people.length === 0) {
        wrapper.appendChild(
          makePlaceholder('No shared connections found yet.'),
        );
      } else {
        src.people.slice(0, 5).forEach((p) => {
          const item = document.createElement('div');
          item.className = 'rounded bg-gray-50 p-1';
          const name = document.createElement('div');
          name.className = 'font-semibold text-gray-800';
          name.textContent = p.name;
          item.appendChild(name);
          if (p.headline) {
            const headline = document.createElement('div');
            headline.className = 'text-[10px] text-gray-500';
            headline.textContent = p.headline;
            item.appendChild(headline);
          }
          wrapper.appendChild(item);
        });
      }
      break;
    case 'social_posts':
      if (!src.available || src.posts.length === 0) {
        wrapper.appendChild(makePlaceholder('No recent posts indexed.'));
      } else {
        src.posts.slice(0, 3).forEach((p) => {
          const item = document.createElement('div');
          item.className = 'rounded bg-gray-50 p-1';
          const head = document.createElement('div');
          head.className = 'flex items-center justify-between text-[10px] text-gray-500';
          const platform = document.createElement('span');
          platform.className = 'uppercase font-semibold';
          platform.textContent = p.platform;
          head.appendChild(platform);
          const when = document.createElement('span');
          when.textContent = p.postedAt;
          head.appendChild(when);
          item.appendChild(head);
          const author = document.createElement('div');
          author.className = 'font-semibold text-gray-800';
          author.textContent = p.author;
          item.appendChild(author);
          const snip = document.createElement('div');
          snip.className = 'mt-0.5 whitespace-pre-wrap break-words';
          snip.textContent = p.snippet;
          item.appendChild(snip);
          wrapper.appendChild(item);
        });
      }
      break;
    case 'interests':
      if (!src.available || src.tags.length === 0) {
        wrapper.appendChild(makePlaceholder('No interests inferred yet.'));
      } else {
        const tagRow = document.createElement('div');
        tagRow.className = 'flex flex-wrap gap-1';
        src.tags.forEach((tag) => {
          const chip = document.createElement('span');
          chip.className =
            'inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700';
          chip.textContent = tag;
          tagRow.appendChild(chip);
        });
        wrapper.appendChild(tagRow);
        if (src.prioritised) {
          const note = document.createElement('div');
          note.className = 'text-[10px] text-emerald-700';
          note.textContent = '★ On your priority list';
          wrapper.appendChild(note);
        }
      }
      break;
    case 'feedback':
      if (!src.available || src.recent.length === 0) {
        wrapper.appendChild(makePlaceholder('No prior feedback on this thread.'));
      } else {
        src.recent.forEach((f) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between text-[11px] text-gray-700';
          const left = document.createElement('span');
          left.textContent = f.comment || `(score ${f.score})`;
          item.appendChild(left);
          const right = document.createElement('span');
          right.className = 'text-gray-500';
          right.textContent = `★ ${f.score}/5`;
          item.appendChild(right);
          wrapper.appendChild(item);
        });
      }
      break;
    default: {
      // Exhaustiveness guard. If a new source kind is added without a
      // renderer we still render *something* so the UI never crashes.
      const unknown = src as { kind: string };
      wrapper.appendChild(makePlaceholder(`Unknown source: ${unknown.kind}`));
      break;
    }
  }
  return wrapper;
}

function labelForSource(kind: ContextSource['kind']): string {
  switch (kind) {
    case 'linkedin_profile':
      return 'LinkedIn Profile';
    case 'company':
      return 'Company';
    case 'email':
      return 'Email history';
    case 'common_connections':
      return 'Common connections';
    case 'social_posts':
      return 'Social posts';
    case 'interests':
      return 'Interests';
    case 'feedback':
      return 'Prior feedback';
    default: {
      const unknown = kind as string;
      return unknown;
    }
  }
}

function makeKv(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'flex items-baseline justify-between gap-2';
  const k = document.createElement('span');
  k.className = 'text-[10px] uppercase tracking-wide text-gray-500';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'text-right text-gray-800';
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function makeLinkKv(label: string, href: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'flex items-baseline justify-between gap-2';
  const k = document.createElement('span');
  k.className = 'text-[10px] uppercase tracking-wide text-gray-500';
  k.textContent = label;
  const a = document.createElement('a');
  a.className = 'text-right text-brand-600 hover:underline truncate max-w-[60%]';
  a.textContent = href;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  row.appendChild(k);
  row.appendChild(a);
  return row;
}

function makePlaceholder(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'italic text-gray-500';
  p.textContent = text;
  return p;
}

function renderDraftArea(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'p-3 flex flex-col gap-2';
  container.style.minHeight = '0';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between';
  const title = document.createElement('h4');
  title.className =
    'text-xs font-semibold uppercase tracking-wide text-gray-500';
  title.textContent = 'Draft reply';
  header.appendChild(title);
  const regenBtn = document.createElement('button');
  regenBtn.id = 'sidePanelRegenerate';
  regenBtn.className =
    'rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed';
  regenBtn.textContent = state.isGeneratingDraft ? 'Generating…' : 'Regenerate';
  regenBtn.disabled = state.isGeneratingDraft || !state.selectedUrn;
  regenBtn.addEventListener('click', () => {
    void generateDraft();
  });
  header.appendChild(regenBtn);
  container.appendChild(header);

  if (state.error) {
    const err = document.createElement('p');
    err.className =
      'rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700';
    err.textContent = state.error;
    container.appendChild(err);
  }

  const textarea = document.createElement('textarea');
  textarea.id = 'sidePanelDraft';
  textarea.className =
    'w-full min-h-[80px] resize-y rounded border border-gray-200 p-2 text-sm focus:border-brand-600 focus:outline-none';
  textarea.placeholder = state.selectedUrn
    ? 'Click Regenerate to draft a reply, or type your own here.'
    : 'Select a thread to enable drafting.';
  textarea.value = state.draft;
  textarea.addEventListener('input', () => {
    state.draft = textarea.value;
  });
  container.appendChild(textarea);

  if (state.draft) {
    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2 mt-1';
    const helpful = document.createElement('button');
    helpful.className =
      'rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100';
    helpful.textContent = '👍 Helpful';
    helpful.addEventListener('click', () => {
      void submitFeedback(5, '');
    });
    actions.appendChild(helpful);
    const notHelpful = document.createElement('button');
    notHelpful.className =
      'rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100';
    notHelpful.textContent = '👎 Not helpful';
    notHelpful.addEventListener('click', () => {
      void submitFeedback(1, '');
    });
    actions.appendChild(notHelpful);
    container.appendChild(actions);
  }

  return container;
}

/* ---------------------------------------------------------------------------
 * Selection + sync
 * ------------------------------------------------------------------------- */

let listenerWired = false;

/**
 * Install the cross-component selection listener exactly once. The
 * Messages tab dispatches `linkedin-ai:thread-selected` whenever the
 * user clicks a conversation; we mirror that selection locally so the
 * panel auto-loads the matching context + draft.
 */
function wireThreadSelectedListener(): void {
  if (listenerWired) return;
  listenerWired = true;
  window.addEventListener(THREAD_SELECTED_EVENT, (event) => {
    const detail = readThreadSelectedDetail(event);
    if (!detail) return;
    const name =
      detail.conversation?.name ??
      state.threads.find((t) => t.urn === detail.urn)?.conversationName ??
      '';
    void selectThread(detail.urn, name);
  });
}

/**
 * Switch the panel to a given thread: refresh the context, kick off
 * an AI draft, and load context sources in parallel.
 */
async function selectThread(
  urn: string,
  name: string = '',
): Promise<void> {
  if (!urn) return;
  state.selectedUrn = urn;
  state.selectedName = name;
  state.contextLoading = true;
  state.contextSourcesLoading = true;
  state.context = [];
  state.contextSources = null;
  state.draft = '';
  state.error = '';
  const root = document.getElementById('sidePanel');
  if (root) render(root);

  // Pull a fresh context + sources + draft for the selected thread in
  // parallel. Each writes its own slice of state and triggers a
  // re-render on completion.
  void loadContext(urn);
  void loadContextSources(urn);

  if (state.context.length > 0) {
    void generateDraft();
  }
}

async function loadContext(urn: string): Promise<void> {
  state.contextLoading = true;
  const messages = await getMessages(urn);
  state.context = messages.slice(-10);
  state.contextLoading = false;
  const root = document.getElementById('sidePanel');
  if (root) render(root);

  // Trigger the draft now that we have context.
  if (state.context.length > 0) {
    void generateDraft();
  }
}

async function loadContextSources(urn: string): Promise<void> {
  state.contextSourcesLoading = true;
  const root = document.getElementById('sidePanel');
  if (root) render(root);
  const payload = await getContextSources(urn);
  state.contextSources = payload;
  state.contextSourcesLoading = false;
  if (root) render(root);
}

async function generateDraft(): Promise<void> {
  if (!state.selectedUrn || state.context.length === 0) {
    state.error = 'Select a thread with messages first.';
    const root = document.getElementById('sidePanel');
    if (root) render(root);
    return;
  }
  state.isGeneratingDraft = true;
  state.error = '';
  const root = document.getElementById('sidePanel');
  if (root) render(root);

  const lastInbound = [...state.context]
    .reverse()
    .find((m) => m.direction === 'inbound');
  const res = await createDraft(
    state.selectedUrn,
    lastInbound?.id ?? '',
    state.context,
    '',
  );

  state.isGeneratingDraft = false;
  if (!res) {
    state.error =
      'Could not reach the backend at /api/draft. Make sure the service backend is running and BACKEND_URL is set.';
  } else {
    state.draft = res.draft.draft || '';
  }
  if (root) render(root);
}

async function submitFeedback(
  score: number,
  comment: string,
): Promise<void> {
  if (!state.selectedUrn) return;
  const lastInbound = [...state.context]
    .reverse()
    .find((m) => m.direction === 'inbound');
  const ok = await saveFeedback({
    threadUrn: state.selectedUrn,
    messageUrn: lastInbound?.id ?? '',
    draft: state.draft,
    sentiment: '',
    score,
    comment,
    model: '',
  });
  state.error = ok
    ? ''
    : 'Could not save feedback (backend unreachable).';
  const root = document.getElementById('sidePanel');
  if (root) render(root);
}

/* ---------------------------------------------------------------------------
 * Small DOM helpers
 * ------------------------------------------------------------------------- */

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}