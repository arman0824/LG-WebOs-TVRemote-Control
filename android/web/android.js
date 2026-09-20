(() => {
  let sequence = 0;
  const pending = new Map();
  window.androidRequest = (path, options = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The TV took too long to respond. Check its power and Wi-Fi or hotspot connection, then try again.'));
    }, path === '/api/connect' ? 110000 : 20000);
    pending.set(id, { resolve, reject, timer });
    LGAndroid.request(id, path, options.body || '{}');
  });
  window.androidComplete = (id, result) => {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    result.error ? request.reject(new Error(result.error)) : request.resolve(result);
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('android-app');
    document.querySelector('#networkHelp').textContent = 'Connect the TV to this phone’s hotspot, or connect both devices to the same Wi-Fi or hotspot. Then scan or enter the TV IP from its network settings.';
    document.querySelector('#scanHint').textContent = 'If hotspot scanning finds no TV, enter its IP above. The hotspot must allow local device connections.';
  });
})();
