const API_URL = 'https://script.google.com/macros/s/AKfycbw9trkW9RNCRSwWou_51Q-FP6aL7Lp8sy3zizSG83fzN1Urtd3ZiMc47RUfHDBTIMJfDw/exec';
const SAMPLE = `HINDI:\nमुझे बैंक से पैसे निकालने हैं।\n\nCHINESE:\n我要去銀行領錢。\n\nPINYIN:\nWǒ yào qù yínháng lǐng qián.\n\nEXPLANATION:\n我要 (wǒ yào) का अर्थ है “मैं ... करना चाहता/चाहती हूँ।”\n去 (qù) का अर्थ “जाना” है।\n銀行 (yínháng) का अर्थ “बैंक” है।\n領錢 (lǐng qián) का अर्थ बैंक से पैसे निकालना है।\n中文語序 (Zhōngwén yǔxù): 主語 (zhǔyǔ) + 要 (yào) + 去 (qù) + 地點 (dìdiǎn) + 動作 (dòngzuò)。\n\nCATEGORY:\nBank`;

const state = { sentences: [], categories: [], settings: {}, preview: null };
const $ = (id) => document.getElementById(id);

function parsePaste(text) {
  const labels = ['HINDI', 'CHINESE', 'PINYIN', 'EXPLANATION', 'CATEGORY', 'TAGS', 'AI SOURCE'];
  const found = {};
  const pattern = new RegExp(`(?:^|\\n)\\s*(${labels.join('|')})\\s*:\\s*`, 'gi');
  const matches = [...text.matchAll(pattern)];
  matches.forEach((match, index) => {
    const key = match[1].toUpperCase();
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    found[key] = text.slice(start, end).trim();
  });
  return {
    hindiSentence: found.HINDI || '', chineseSentence: found.CHINESE || '',
    pinyin: found.PINYIN || '', hindiExplanation: found.EXPLANATION || '',
    category: found.CATEGORY || 'Other', tags: found.TAGS || '',
    aiSource: found['AI SOURCE'] || 'ChatGPT / Gemini', originalPaste: text
  };
}

function createCard(sentence, preview = false) {
  const node = $('cardTemplate').content.firstElementChild.cloneNode(true);
  node.querySelector('.category-pill').textContent = sentence.category || 'Other';
  node.querySelector('.record-id').textContent = preview ? 'PREVIEW' : sentence.recordId || '';
  node.querySelector('.hindi').textContent = sentence.hindiSentence;
  node.querySelector('.chinese').textContent = sentence.chineseSentence;
  node.querySelector('.pinyin').textContent = sentence.pinyin;
  node.querySelector('.explanation').textContent = sentence.hindiExplanation || 'No explanation added.';
  const tags = String(sentence.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  node.querySelector('.tags').innerHTML = tags.map(tag => `<span class="tag"></span>`).join('');
  node.querySelectorAll('.tag').forEach((el, i) => { el.textContent = tags[i]; });
  const speak = node.querySelector('.speak-button');
  speak.addEventListener('click', () => speakChinese(sentence.chineseSentence, speak));
  return node;
}

function speakChinese(text, button) {
  if (!('speechSynthesis' in window)) return alert('Speech is not supported in this browser. Please try Chrome, Edge or Safari.');
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = state.settings.defaultVoice || 'zh-TW';
  utterance.rate = Number(state.settings.speechRate) || 0.85;
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.lang.toLowerCase() === 'zh-tw') || voices.find(v => v.lang.toLowerCase().startsWith('zh')) || null;
  utterance.onstart = () => button.classList.add('speaking');
  utterance.onend = utterance.onerror = () => button.classList.remove('speaking');
  speechSynthesis.speak(utterance);
}

function renderFilters() {
  const select = $('categoryFilter');
  select.innerHTML = '<option value="">All categories</option>';
  state.categories.forEach(category => select.add(new Option(category, category)));
}

function renderSentences() {
  const query = $('searchInput').value.trim().toLowerCase();
  const category = $('categoryFilter').value;
  const visible = state.sentences.filter(s => {
    const haystack = [s.hindiSentence,s.chineseSentence,s.pinyin,s.hindiExplanation,s.tags].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!category || s.category === category);
  });
  const grid = $('sentenceGrid'); grid.innerHTML = '';
  visible.forEach(s => grid.appendChild(createCard(s)));
  $('resultCount').textContent = `${visible.length} shown`;
  $('emptyState').classList.toggle('hidden', visible.length > 0);
}

function handlePreview() {
  const text = $('pasteInput').value.trim();
  if (!text) { $('parseMessage').textContent = 'Paste an AI answer first.'; return; }
  const parsed = parsePaste(text);
  const missing = [['Hindi',parsed.hindiSentence],['Chinese',parsed.chineseSentence],['Pinyin',parsed.pinyin],['Explanation',parsed.hindiExplanation]].filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) { $('parseMessage').textContent = `Please add these labelled parts: ${missing.join(', ')}.`; return; }
  state.preview = parsed; $('parseMessage').textContent = '';
  const mount = $('previewCard'); mount.innerHTML = ''; mount.appendChild(createCard(parsed, true));
  $('previewPanel').classList.remove('hidden'); $('previewPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

function receiveBank(data) {
  window.__sentenceBankLoaded = true;
  if (!data || !data.success) return showApiError('The API returned an error.');
  state.settings = data.settings || {}; state.sentences = data.sentences || [];
  state.categories = String(state.settings.categories || '').split(',').map(s => s.trim()).filter(Boolean);
  $('bankName').textContent = state.settings.bankName || 'My Chinese Sentence Bank';
  $('ownerName').textContent = state.settings.ownerName && state.settings.ownerName !== 'Your Name' ? `Made for ${state.settings.ownerName}` : 'A personal language notebook';
  document.title = state.settings.bankName || 'My Chinese Sentence Bank';
  $('sentenceCount').textContent = state.sentences.length; $('categoryCount').textContent = state.categories.length;
  $('apiStatus').className = 'live-status ready'; $('apiStatus').innerHTML = '<i></i> Google Sheet connected';
  renderFilters(); renderSentences();
}

function showApiError(message) {
  $('apiStatus').className = 'live-status error'; $('apiStatus').innerHTML = '<i></i> Connection problem';
  $('sentenceGrid').innerHTML = `<div class="loading-card">${message} Refresh the page to try again.</div>`;
}

function openPinDialog() {
  if (!state.preview) return;
  try { $('pinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
  $('saveMessage').textContent = '';
  $('pinDialog').showModal();
  setTimeout(() => $('pinInput').focus(), 50);
}

function submitSentence() {
  const pin = $('pinInput').value.trim();
  if (!pin) { $('saveMessage').textContent = 'Enter the submission PIN.'; return; }
  if (!state.preview) { $('pinDialog').close(); return; }
  if ($('rememberPin').checked) { try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {} }
  else { try { localStorage.removeItem('csbSubmissionPin'); } catch (_) {} }

  $('confirmSave').disabled = true;
  $('saveMessage').textContent = 'Opening Google confirmation…';
  const beforeIds = new Set(state.sentences.map(s => s.recordId));
  const fields = { action:'create', pin, content:state.preview.originalPaste, aiSource:state.preview.aiSource };
  const form = document.createElement('form');
  form.method = 'POST'; form.action = API_URL; form.target = '_blank'; form.hidden = true;
  Object.entries(fields).forEach(([name,value]) => {
    const field = name === 'content' ? document.createElement('textarea') : document.createElement('input');
    field.name = name; field.value = value; form.appendChild(field);
  });
  document.body.appendChild(form); form.submit(); form.remove();

  let checks = 0;
  const verify = setInterval(() => {
    checks += 1;
    const callback = `verifySave${Date.now()}`;
    window[callback] = data => {
      delete window[callback]; script.remove();
      const rows = data && data.success ? data.sentences || [] : [];
      const added = rows.find(row => !beforeIds.has(row.recordId) && row.originalPaste === state.preview.originalPaste);
      if (added) {
        clearInterval(verify); state.sentences = rows;
        $('sentenceCount').textContent = rows.length; renderSentences();
        $('saveMessage').textContent = 'Saved successfully!'; $('confirmSave').disabled = false;
        $('pasteInput').value = ''; $('previewPanel').classList.add('hidden');
        setTimeout(() => { $('pinDialog').close(); $('libraryTitle').scrollIntoView({behavior:'smooth'}); }, 800);
      } else if (checks >= 5) {
        clearInterval(verify); $('confirmSave').disabled = false;
        $('saveMessage').textContent = 'Could not confirm the save. Check the PIN and try again.';
      }
    };
    const script = document.createElement('script');
    script.src = `${API_URL}?action=list&callback=${callback}&_=${Date.now()}`;
    document.body.appendChild(script);
  }, 1800);
}

function loadBank() {
  window.sentenceBankCallback = receiveBank;
  const script = document.createElement('script');
  script.src = `${API_URL}?action=list&callback=sentenceBankCallback&_=${Date.now()}`;
  script.onerror = () => showApiError('Could not reach Google Sheets.'); document.body.appendChild(script);
  setTimeout(() => { if (!window.__sentenceBankLoaded) showApiError('Google Sheets took too long to respond.'); }, 12000);
}

$('startButton').addEventListener('click', () => $('addSentence').scrollIntoView({behavior:'smooth'}));
$('sampleButton').addEventListener('click', () => { $('pasteInput').value = SAMPLE; $('pasteInput').focus(); });
$('clearButton').addEventListener('click', () => { $('pasteInput').value = ''; $('parseMessage').textContent = ''; $('previewPanel').classList.add('hidden'); });
$('previewButton').addEventListener('click', handlePreview);
$('searchInput').addEventListener('input', renderSentences);
$('categoryFilter').addEventListener('change', renderSentences);
$('helpButton').addEventListener('click', () => $('helpDialog').showModal());
$('closeHelp').addEventListener('click', () => $('helpDialog').close());
$('helpDialog').addEventListener('click', e => { if (e.target === $('helpDialog')) $('helpDialog').close(); });
$('saveButton').addEventListener('click', openPinDialog);
$('confirmSave').addEventListener('click', submitSentence);
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitSentence(); });
$('closePin').addEventListener('click', () => $('pinDialog').close());
loadBank();
