/**
 * Tabs Module
 * Handles tab navigation
 */

export function setupTabs(): void {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      if (tabName) switchTab(tabName);
    });
  });
}

export function switchTab(tabName: string): void {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `${tabName}-tab`);
  });
}