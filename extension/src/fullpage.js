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
  setupNav();
  setupButtons();
  await Promise.all([loadDashboard(), loadSequencer(), loadConversations()]);
});

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-page');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    });
  });
}

function setupButtons() {
  document.getElementById('btnScrape')?.addEventListener('click', handleScrape);
  document.getElementById('btnSaveSequencer')?.addEventListener('click', handleSave);
  document.getElementById('btnAddStep')?.addEventListener('click', handleAddStep);
  document.getElementById('btnExecute')?.addEventListener('click', () => alert('Phase 2 feature'));
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
  const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  s('statConversations', d.totalConversations);
  s('statToReply', d.messagesToReply);
  s('statSent', d.sentMessages);
  s('statReceived', d.receivedMessages);
  s('statPositive', d.positiveOutcomes);
  s('statNegative', d.negativeOutcomes);
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
    '<div class="seq-step"><span class="seq-num">' + (i+1) + '</span><div class="seq-info"><div class="seq-type">' + step.type + '</div><div class="seq-detail">' + (step.content || step.prompt || 'Wait ' + step.duration + ' days') + '</div></div></div>'
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
    '<div class="contact-item" data-index="' + i + '"><div class="contact-avatar">' + getInitials(conv.name) + '</div><div><div class="contact-name">' + conv.name + '</div><div class="contact-preview">' + (conv.preview || '') + '</div></div></div>'
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
  if (v && conv) v.innerHTML = '<h3>' + conv.name + '</h3><p>' + (conv.preview || 'No messages') + '</p>';
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}
