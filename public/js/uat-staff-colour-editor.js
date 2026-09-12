(() => {
  'use strict';
  const root = document.getElementById('uatStaffColourControl');
  if (!root) return;
  const staffId = Number(root.dataset.staffId || 0);
  const basePath = String(root.dataset.basePath || '');
  const input = root.querySelector('[data-staff-colour]');
  const label = root.querySelector('[data-staff-colour-label]');
  const reset = root.querySelector('[data-staff-colour-reset]');

  async function request(path, options={}) {
    const response = await fetch(`${basePath}${path}`, {
      credentials:'same-origin', cache:'no-store',
      headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {})},
      ...options
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function setLabel(color, custom) {
    label.textContent = custom ? `${color.toUpperCase()} · custom staff colour` : `${color.toUpperCase()} · default colour`;
  }

  async function load() {
    try {
      const data = await request('/api/uat/staff-colors');
      const person = (data.staff || []).find(item => Number(item.id) === staffId);
      if (!person) throw new Error('Staff colour is unavailable.');
      input.value = person.color;
      setLabel(person.color, person.custom);
    } catch (error) {
      label.textContent = error.message;
    }
  }

  input.addEventListener('change', async () => {
    input.disabled = true;
    label.textContent = 'Saving colour…';
    try {
      const data = await request(`/api/uat/staff-colors/${staffId}`, { method:'POST', body:JSON.stringify({ color:input.value }) });
      input.value = data.staff.color;
      setLabel(data.staff.color, true);
    } catch (error) {
      label.textContent = error.message;
    } finally { input.disabled = false; }
  });

  reset.addEventListener('click', async () => {
    reset.disabled = true;
    label.textContent = 'Restoring default…';
    try {
      const data = await request(`/api/uat/staff-colors/${staffId}`, { method:'DELETE' });
      input.value = data.color;
      setLabel(data.color, false);
    } catch (error) {
      label.textContent = error.message;
    } finally { reset.disabled = false; }
  });

  load();
})();
