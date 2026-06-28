const state = { conversations: [], activeConversation: null, messages: [], sequencer: null };

async function handleScrape() {
  const btn = document.getElementById('btnScrape');
  const countInput = document.getElementById('scrapeCount');
  const count = parseInt(countInput?.value) || 5;
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    if (tabs.length === 0) { alert('No LinkedIn tab open.'); return; }
    const msgTab = tabs.find(t => t.url?.includes('/messaging')) || tabs[0];
    if (!msgTab?.id) { alert('Could not access LinkedIn tab.'); return; }
    const results = await chrome.scripting.executeScript({
      target: { tabId: msgTab.id },
      func: scrapeConversations,
      args: [count]
    });
    if (results?.[0]?.result?.length > 0) {
      state.conversations = results[0].result;
      renderContacts();
      document.getElementById('statConversations').textContent = state.conversations.length;
      document.getElementById('convCount').textContent = state.conversations.length;
      switchToTab('messages');
      alert('Scraped ' + state.conversations.length + ' conversations!');
    } else {
      alert('No conversations found.');
    }
  } catch (e) { alert('Error: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Scrape Conversations'; } }
}

function scrapeConversations(limit) {
  const items = document.querySelectorAll('.msg-conversations-container__convo-item, li[class*="conversation-listitem"]');
  const results = [];
  items.forEach((item, i) => {
    if (i >= limit) return;
    const nameEl = item.querySelector('h3, [class*="name"], [class*="participant"]');
    const name = nameEl?.textContent?.trim() || 'Unknown';
    const previewEl = item.querySelector('[class*="snippet"], p');
    const preview = previewEl?.textContent?.trim() || '';
    const timeEl = item.querySelector('time');
    const time = timeEl?.textContent?.trim() || '';
    results.push({ id: 'conv_' + i, name, preview, time });
  });
  return results;
}

function switchToTab(page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-page') === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
}

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupButtons();
  loadSequencer();
  loadConversations();
});

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.getAttribute('data-page'));
  });
}

function setupButtons() {
  document.getElementById('btnScrape')?.addEventListener('click', handleScrape);
  document.getElementById('btnSaveSequencer')?.addEventListener('click', handleSave);
  document.getElementById('btnAddStep')?.addEventListener('click', handleAddStep);
  document.getElementById('btnExecute')?.addEventListener('click', () => alert('Phase 2'));
}

async function loadSequencer() {
  const res = await chrome.storage.local.get(['sequencer']);
  state.sequencer = res.sequencer || { id: 'default', name: 'Default', steps: [{ id: 'step1', type: 'delay', duration: 2, next: null }] };
  renderSequencer(state.sequencer);
}

function renderSequencer(s) {
  const ni = document.getElementById('sequencerName');
  if (ni && s) ni.value = s.name || '';
  const c = document.getElementById('sequencerSteps');
  if (c && s?.steps) {
    c.innerHTML = s.steps.map((step, i) => {
      const detail = step.content || step.prompt || ('Wait ' + step.duration + ' days');
      return '<div class="seq-step"><span class="seq-num">' + (i+1) + '</span><div class="seq-info"><div class="seq-type">' + step.type + '</div><div class="seq-detail">' + detail + '</div></div></div>';
    }).join('');
  }
}

async function handleSave() {
  const ni = document.getElementById('sequencerName');
  if (!ni || !state.sequencer) return;
  state.sequencer.name = ni.value;
  await chrome.storage.local.set({ sequencer: state.sequencer });
  alert('Saved!');
}

function handleAddStep() {
  if (!state.sequencer) return;
  state.sequencer.steps.push({ id: 'step_' + Date.now(), type: 'message', content: 'New message...', next: null });
  renderSequencer(state.sequencer);
}

async function loadConversations() {
  const res = await chrome.storage.local.get(['conversations']);
  state.conversations = res.conversations || [];
  document.getElementById('convCount').textContent = state.conversations.length;
  renderContacts();
}

function renderContacts() {
  const c = document.getElementById('contactsList');
  if (!c) return;
  if (!state.conversations.length) {
    c.innerHTML = '<div class="empty-state"><p>No conversations</p></div>';
    return;
  }
  c.innerHTML = state.conversations.map((conv, i) => {
    const initials = getInitials(conv.name);
    return '<div class="contact-item" data-idx="' + i + '"><div class="contact-avatar">' + initials + '</div><div class="contact-info"><div class="contact-name"><strong>' + conv.name + '</strong></div><div class="contact-preview">' + (conv.preview || '') + '</div></div></div>';
  }).join('');
  c.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => selectConversation(parseInt(item.getAttribute('data-idx')));
  });
}

async function selectConversation(idx) {
  state.activeConversation = state.conversations[idx];
  document.querySelectorAll('.contact-item').forEach((item, i) => item.classList.toggle('active', i === idx));
  if (!state.activeConversation) return;
  const v = document.getElementById('conversationView');
  if (!v) return;
  v.innerHTML = '<div class="messages-header"><h3>' + state.activeConversation.name + '</h3></div><div class="loading-msg">Scraping messages...</div>';
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    const msgTab = tabs.find(t => t.url?.includes('/messaging')) || tabs[0];
    if (!msgTab?.id) { v.innerHTML = '<p>No LinkedIn tab found</p>'; return; }
    const results = await chrome.scripting.executeScript({
      target: { tabId: msgTab.id },
      func: scrapeMessages,
      args: [idx]
    });
    if (results?.[0]?.result) {
      state.messages = results[0].result;
      renderMessages();
    } else {
      v.innerHTML = '<div class="messages-header"><h3>' + state.activeConversation.name + '</h3></div><p style="color:#6b7280">Click on this conversation in LinkedIn to load messages</p>';
    }
  } catch (e) {
    v.innerHTML = '<p style="color:red">Error: ' + e.message + '</p>';
  }
}

function scrapeMessages(idx) {
  const items = document.querySelectorAll('.msg-s-message-list__event');
  const messages = [];
  items.forEach(item => {
    if (item.classList.contains('msg-s-message-list__top-of-list')) return;
    if (item.classList.contains('msg-s-message-list__loader')) return;
    if (item.classList.contains('msg-s-message-list__typing-indicator')) return;
    const senderEl = item.querySelector('.msg-s-message-group__profile-link, .msg-s-event-listitem__profile-link');
    const sender = senderEl?.textContent?.trim() || 'Unknown';
    const contentEl = item.querySelector('.msg-s-event-listitem__body');
    const content = contentEl?.textContent?.trim() || '';
    const timeEl = item.querySelector('.msg-s-message-group__timestamp, .msg-s-event-listitem__timestamp');
    const time = timeEl?.textContent?.trim() || '';
    const isOwn = item.classList.contains('msg-s-event-listitem--own');
    if (content) messages.push({ sender, content, time, isOwn });
  });
  return messages;
}

function renderMessages() {
  const v = document.getElementById('conversationView');
  if (!v || !state.messages.length) {
    if (v) v.innerHTML += '<p style="color:#6b7280">No messages found</p>';
    return;
  }
  const header = '<div class="messages-header"><h3>' + (state.activeConversation?.name || '') + '</h3></div>';
  const msgs = state.messages.map(m => {
    const cls = m.isOwn ? 'msg own' : 'msg other';
    return '<div class="' + cls + '"><div class="msg-sender">' + m.sender + ' <span class="msg-time">' + m.time + '</span></div><div class="msg-content">' + m.content + '</div></div>';
  }).join('');
  v.innerHTML = header + '<div class="messages-list">' + msgs + '</div>';
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}
