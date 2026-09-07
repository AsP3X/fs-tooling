// Human: Extension options — user-configured custom desk origins. No tenant is hardcoded.
// Agent: CALLS worker sth.desks.* then chrome.permissions.request from this page (content scripts cannot request hosts).

const deskInput = document.getElementById('deskInput');
const deskStatus = document.getElementById('deskStatus');
const deskList = document.getElementById('deskList');

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setStatus(text, kind) {
  deskStatus.textContent = text;
  deskStatus.className = kind === 'err' ? 'hint err' : kind === 'ok' ? 'hint ok' : 'hint';
}

async function render() {
  const res = await send({ type: 'sth.desks.list' });
  const desks = Array.isArray(res?.desks) ? res.desks : [];
  deskList.replaceChildren();
  desks.forEach((row) => {
    const origin = String(row.origin || '');
    if (!origin) return;
    const item = document.createElement('div');
    item.className = 'desk';
    const code = document.createElement('code');
    code.textContent = origin.replace(/^https:\/\//, '');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost';
    del.textContent = 'Remove';
    del.addEventListener('click', async () => {
      await send({ type: 'sth.desks.remove', origin });
      await render();
    });
    item.append(code, del);
    deskList.appendChild(item);
  });
}

async function addDesk() {
  const raw = deskInput.value;
  const parsed = await send({ type: 'sth.desks.parse', raw });
  if (!parsed?.ok) {
    setStatus('Enter an https Freshservice URL, like https://desk.example.com', 'err');
    return;
  }
  if (parsed.builtin) {
    setStatus('That host is already included (*.freshservice.com / *.myfreshworks.com).', 'ok');
    return;
  }
  const origin = String(parsed.origin || '');
  try {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      setStatus('Chrome needs site access to show the panel on that desk.', 'err');
      return;
    }
  } catch {
    setStatus('Could not ask Chrome for site access.', 'err');
    return;
  }
  const saved = await send({ type: 'sth.desks.add', origin });
  if (!saved?.ok) {
    setStatus(saved?.error || 'Could not save that desk.', 'err');
    return;
  }
  deskInput.value = '';
  setStatus('Saved. Open the desk and refresh, or click the toolbar icon.', 'ok');
  await render();
}

document.getElementById('addDesk').addEventListener('click', () => { void addDesk(); });
deskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void addDesk();
  }
});
void render();
