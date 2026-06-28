/**
 * Side Panel - AI reply drafting + top-15 thread list.
 *
 * Layout (3-column grid in `fullpage.html`):
 *  - Left:    existing contact list (rendered by `modules/messages.ts`)
 *  - Center:  existing thread view (rendered by `modules/messages.ts`)
 *  - Right:   THIS module's side panel
 *
 * The panel's three regions:
 *  1. **Top-15 thread list**  - `GET /api/threads?limit=15` (descending by
 *     `lastScrapedAt`). Click a row to load that thread's context.
 *  2. **Context**  - last 10 inbound messages for the selected thread
 *     (`GET /api/messages?threadUrn=...`). Shows up to 10 with a
 *     "Generating context..." placeholder while loading.
 *  3. **Draft + feedback**  - a `<textarea>` for the AI draft, a
 *     "Regenerate" button that calls `POST /api/draft`, and thumbs
 *     up/down + comment that POSTs to `/api/feedback`.
 *
 * No-bug safeguards:
 *  - Empty-state placeholders so the panel never looks broken.
 *  - Disabled state on the Regenerate button while in-flight.
 *  - Errors degrade to a small error text; the user can still type
 *    their own draft manually.
 */

import type { ConversationMessage } from '../types.js';
import {
  getTopThreads,
  getMessages,
  createDraft,
  saveFeedback,
  type BackendThread,
} from './api.js';

interface PanelState {
  selectedUrn: string | null;
  threads: BackendThread[];
  context: ConversationMessage[];
  draft: string;
  isGeneratingDraft: boolean;
  contextLoading: boolean;
  error: string;
}

let state: PanelState = {
  selectedUrn: null,
  threads: [],
  context: [],
  draft: '',
  isGeneratingDraft: false,
  contextLoading: false,
  error: '',
};

let mounted = false;

/**
 * Mount the side panel. Safe to call multiple times; subsequent calls
 * just refresh the contents.
 */
export async function mountSidePanel(): Promise<void> {
  const root = document.getElementById('sidePanel');
  if (!root) {
    // Page hasn't loaded the side-panel slot yet - caller can retry.
    return;
  }
  mounted = true;
  await refreshThreadList();
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
  title.textContent = 'AI Reply Panel';
  left.appendChild(title);
  const subtitle = document.createElement('span');
  subtitle.className = 'text-xs text-gray-500';
  subtitle.textContent = 'Top 15 threads + AI draft';
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
  container.style.maxHeight = '40%';
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
    void selectThread(t.urn);
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
  container.style.maxHeight = '25%';
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

async function selectThread(urn: string): Promise<void> {
  if (!urn) return;
  state.selectedUrn = urn;
  state.contextLoading = true;
  state.context = [];
  state.draft = '';
  state.error = '';
  const root = document.getElementById('sidePanel');
  if (root) render(root);

  // Always pull a fresh context for the selected thread.
  state.context = await getMessages(urn);
  state.contextLoading = false;
  if (root) render(root);

  // Auto-draft on selection so the user always sees a starting point.
  if (state.context.length > 0) {
    await generateDraft();
  }
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
