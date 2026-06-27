/**
 * LinkedIn AI GTM - Full Page Application
 */

const state = { conversations: [], sequencer: null, dashboard: null, activeConversation: null };

async function sendMessage(type, data = {}) {
  console.log('[FullPage] Sending:', type);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      console.log('[FullPage] Got:', response);
      resolve(response);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[FullPage] Starting...');
  setupTabs();
  setupButtons();
  await Promise.all([loadDashboard(), loadSequencer(), loadConversations()]);
});

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-tab');
      if (!name) return;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === name));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === name + '-tab'));
    });
  });
}

function setupButtons() {
  document.getElementById('btnScrape')?.addEventListener('click', handleScrape);
  document.getElementById('btnSaveSequencer')?.addEventListener('click', handleSave);
  document.getElementById('btnAddStep')?.addEventListener('click', handleAddStep);
  document.getElementById('btnExecute')?.addEventListener('click', () => alert('Phase 2'));
}

async function handleScrape() {
  const btn = document.getElementById('btnScrape');
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }
  try {
    const res = await sendMessage('SCRAPE_CONVERSATIONS', { limit: 20 });
    if (res.success) {
      state.conversations = res.conversations || [];
      renderContacts();
      await loadDashboard();
      alert('Scraped ' + state.conversations.length + ' conversations!');
    } else alert('Error: ' + res.error);
  } catch (e) { alert('Failed. Make sure you are on LinkedIn.'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Scrape'; } }
}

async function loadDashboard() {
  try {
    const res = await sendMessage('GET_DASHBOARD');
    if (res.success) { state.dashboard = res.data; renderDashboard(res.data); }
  } catch (e) { console.error(e); }
}

function renderDashboard(d) {
  const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = String(v); };
  s('statConversations', d.totalConversations); s('statToReply', d.messagesToReply);
  s('statSent', d.sentMessages); s('statReceived', d.receivedMessages);
  s('statPositive', d.positiveOutcomes); s('statNegative', d.negativeOutcomes);
  const t = document.getElementById('lastScrapeTime');
  if (t) t.textContent = d.lastScrapeTime ? new Date(d.lastScrapeTime).toLocaleString() : 'Never';
}

async function loadSequencer() {
  try {
    const res = await sendMessage('GET_SEQUENCER');
    if (res.success) { state.sequencer = res.data; renderSequencer(res.data); }
  } catch (e) { console.error(e); }
}

function renderSequencer(s) {
  const ni = document.getElementById('sequencerName');
  if (ni) ni.value = s.name;
  const c = document.getElementById('sequencerSteps');
  if (c) c.innerHTML = s.steps.map((step, i) => 
    '<div class="sequencer-step"><span class="step-number">' + (i+1) + '</span><div class="step-content"><div class="step-type">' + step.type + '</div><div class="step-detail">' + (step.content || step.prompt || 'Wait ' + step.duration + ' days') + '</div></div></div>'
  ).join('');
}

async function handleSave() {
  const ni = document.getElementById('sequencerName');
  if (!ni || !state.sequencer) return;
  state.sequencer.name = ni.value;
  await sendMessage('SAVE_SEQUENCER', { sequencer: state.sequencer });
  alert('Saved!');
}

function handleAddStep() {
  if (!state.sequencer) return;
  state.sequencer.steps.push({ id: 'step_' + Date.now(), type: 'message', content: 'New message...', next: null });
  renderSequencer(state.sequencer);
}

async function loadConversations() {
  try {
    const res = await sendMessage('GET_CONVERSATIONS');
    if (res.success) { state.conversations = res.data || []; renderContacts(); }
  } catch (e) { console.error(e); }
}

function renderContacts() {
  const c = document.getElementById('contactsList');
  if (!c) return;
  if (!state.conversations.length) { c.innerHTML = '<div class="empty-state"><p>No conversations</p></div>'; return; }
  c.innerHTML = state.conversations.map((conv, i) => 
    '<div class="contact-item" data-index="' + i + '"><div class="contact-avatar">' + conv.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() + '</div><div class="contact-name">' + conv.name + '</div></div>'
  ).join('');
  c.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => selectConversation(parseInt(item.getAttribute('data-index') || '0')));
  });
}

function selectConversation(i) {
  state.activeConversation = state.conversations[i];
  document.querySelectorAll('.contact-item').forEach((item, idx) => item.classList.toggle('active', idx === i));
  const conv = state.activeConversation;
  const v = document.getElementById('conversationView');
  if (v && conv) v.innerHTML = '<div class="conversation-header"><div class="contact-avatar">' + conv.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() + '</div><div class="contact-info"><div class="contact-name">' + conv.name + '</div><div class="conversation-time">' + conv.time + '</div></div></div><div class="conversation-messages"><div class="message-preview">' + (conv.preview || 'No messages') + '</div></div>';
}
