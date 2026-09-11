const API_URL = 'https://script.google.com/macros/s/AKfycbw9trkW9RNCRSwWou_51Q-FP6aL7Lp8sy3zizSG83fzN1Urtd3ZiMc47RUfHDBTIMJfDw/exec';
const SAMPLE = `HINDI:\nमुझे बैंक से पैसे निकालने हैं।\n\nCHINESE:\n我要去銀行領錢。\n\nPINYIN:\nWǒ yào qù yínháng lǐng qián.\n\nEXPLANATION:\n我要 (wǒ yào) का अर्थ है “मैं ... करना चाहता/चाहती हूँ।”\n去 (qù) का अर्थ “जाना” है।\n銀行 (yínháng) का अर्थ “बैंक” है।\n領錢 (lǐng qián) का अर्थ बैंक से पैसे निकालना है।\n中文語序 (Zhōngwén yǔxù): 主語 (zhǔyǔ) + 要 (yào) + 去 (qù) + 地點 (dìdiǎn) + 動作 (dòngzuò)。\n\nCATEGORY:\nBank`;
const AI_PROMPT = `You are a Taiwanese Mandarin teacher for a Hindi-speaking beginner. Convert the Hindi sentence below into natural Traditional Chinese used in Taiwan.\n\nHINDI SENTENCE:\n[Paste one Hindi sentence here]\n\nReturn ONLY the following labelled sections. Do not add an introduction or conclusion. Keep every label exactly as written and do not add Markdown symbols such as ** around the labels.\n\nHINDI:\n[Repeat the original Hindi sentence]\n\nCHINESE:\n[One natural Traditional Chinese sentence used in Taiwan]\n\nPINYIN:\n[Hanyu Pinyin with tone marks for the complete Chinese sentence]\n\nEXPLANATION:\n[Explain every Chinese word and the grammar in clear Hindi. Whenever any Chinese character, word, phrase, or example appears, immediately add its pinyin in parentheses. Use Traditional Chinese only.]\n\nCATEGORY:\n[Choose exactly one: Daily Life, School, Home, Restaurant, Shopping, Bank, Hospital, Travel, Train & Bus, Airport, Work, Friends, Other]\n\nTAGS:\n[Three to five short English keywords separated by commas]\n\nAI SOURCE:\n[Write ChatGPT or Gemini]`;
const AI_PROMPT_TEMPLATE = `Role: You are a professional Chinese teacher whose native language is Hindi. Your students are beginners learning Chinese from India. Please conduct all teaching and explanations throughout in a friendly, professional Hindi tone.

Core Task: Translate the Hindi or Romanized Hindi sentence I provide into natural spoken Traditional Chinese as used in Taiwan, then break down and explain its vocabulary and grammatical structure in Hindi.

Formatting and Output Guidelines: Return exactly the six section headers below in this order. Put every header on its own line exactly as written, without Markdown symbols such as ** or #.

HINDI:
Present the original Hindi sentence in full. If the input is Romanized Hindi, convert it into correct Devanagari Hindi.

CHINESE:
Provide an accurate, authentic Traditional Chinese translation using Traditional Chinese characters exclusively.

PINYIN:
Provide the complete Hanyu Pinyin with correct tone marks and punctuation.

EXPLANATION:
Use Hindi throughout to explain the complete meaning, each important word, useful phrases, measure words, word order and overall grammar in detail. Whenever a Chinese word, character, phrase or example is mentioned, include the Traditional Chinese, Pinyin and Hindi meaning together in this format: 漢字 (pīnyīn) - Hindi explanation. Never show Chinese in the explanation without pinyin.

CATEGORY:
Choose exactly one: Daily Life, School, Home, Restaurant, Shopping, Bank, Hospital, Travel, Train & Bus, Airport, Work, Friends, Other

TAGS:
Provide 3 to 6 short English search keywords separated by commas.

Do not add an introduction, conclusion, note or any additional section.

Sentence to be explained:
{{STUDENT_SENTENCE}}`;

const state = { sentences: [], categories: [], selectedCategories: new Set(), settings: {}, preview: null };
const $ = (id) => document.getElementById(id);

function parsePaste(text) {
  const labels = ['HINDI', 'CHINESE', 'PINYIN', 'EXPLANATION', 'CATEGORY', 'TAGS', 'AI SOURCE'];
  const found = {};
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?\\s*(${labels.join('|')})\\s*:?\\s*(?:\\*\\*)?\\s*:?\\s*`, 'gi');
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

function buildPrompt() {
  const sentence = $('promptSentence').value.trim();
  if (!sentence) {
    $('promptMessage').textContent = 'Type one Hindi or Romanized Hindi sentence first.';
    $('promptSentence').focus();
    return '';
  }
  const prompt = AI_PROMPT_TEMPLATE.replace('{{STUDENT_SENTENCE}}', sentence);
  $('generatedPrompt').value = prompt;
  $('generatedPromptPanel').classList.remove('hidden');
  $('promptMessage').textContent = '';
  $('promptCopyStatus').textContent = '';
  $('generatedPromptPanel').scrollIntoView({behavior:'smooth', block:'nearest'});
  return prompt;
}

function decodeMobileClipboardText(text) {
  let value = String(text || '').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const encodedBytes = value.match(/%[0-9a-f]{2}/gi) || [];
    if (encodedBytes.length < 3) break;
    try {
      const decoded = decodeURIComponent(value.replace(/\+/g, '%20'));
      if (decoded === value) break;
      value = decoded;
    } catch (_) {
      break;
    }
  }
  return value;
}

async function copyPromptText() {
  const prompt = $('generatedPrompt').value || buildPrompt();
  if (!prompt) return false;
  try {
    await navigator.clipboard.writeText(prompt);
  } catch (_) {
    $('generatedPrompt').focus();
    $('generatedPrompt').select();
    if (!document.execCommand('copy')) {
      $('promptCopyStatus').textContent = 'Select the prompt and copy it manually.';
      return false;
    }
  }
  $('promptCopyStatus').textContent = 'Prompt copied!';
  setTimeout(() => { $('promptCopyStatus').textContent = ''; }, 1800);
  return true;
}

function copyAndOpen(url) {
  const prompt = $('generatedPrompt').value || buildPrompt();
  if (!prompt) return;
  const isMobile = window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    copyPromptText().then(copied => {
      if (copied) window.location.assign(url);
    });
    return;
  }
  const newPage = window.open(url, '_blank', 'noopener,noreferrer');
  copyPromptText();
  if (!newPage) $('promptCopyStatus').textContent = 'Prompt copied. Please allow pop-ups, then open the AI website.';
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
  const mount = $('topicOptions');
  mount.innerHTML = '';
  state.selectedCategories = new Set(state.categories.map(normalizeSearchText));
  state.categories.forEach((category, index) => {
    const label = document.createElement('label');
    label.className = 'topic-option';
    label.innerHTML = `<input type="checkbox" value=""><span class="check-circle" aria-hidden="true"></span><span class="topic-name"></span>`;
    const input = label.querySelector('input');
    input.value = category;
    input.checked = true;
    input.id = `topic-${index}`;
    label.querySelector('.topic-name').textContent = category;
    input.addEventListener('change', () => {
      const key = normalizeSearchText(category);
      if (input.checked) state.selectedCategories.add(key);
      else state.selectedCategories.delete(key);
      updateTopicPicker();
      renderSentences();
    });
    mount.appendChild(label);
  });
  updateTopicPicker();
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function sentenceTopics(sentence) {
  const known = new Set(state.categories.map(normalizeSearchText));
  const values = [sentence.category].concat(String(sentence.tags || '').split(/[,;|]/));
  return new Set(values.map(normalizeSearchText).filter(value => known.has(value)));
}

function matchesKeywordExpression(haystack) {
  const terms = ['keywordA', 'keywordB', 'keywordC'].map(id => normalizeSearchText($(id).value));
  const operations = [$('operatorAB').value, $('operatorBC').value];
  let result = null;
  terms.forEach((term, index) => {
    if (!term) return;
    const found = haystack.includes(term);
    if (result === null) result = found;
    else result = operations[index - 1] === 'OR' ? result || found : result && found;
  });
  return result === null ? true : result;
}

function updateTopicPicker() {
  const total = state.categories.length;
  const selected = state.selectedCategories.size;
  const all = $('topicAll');
  all.checked = total > 0 && selected === total;
  all.indeterminate = selected > 0 && selected < total;
  $('topicSummary').textContent = selected === total ? 'All topics' : selected === 0 ? 'Any topic' : `${selected} topics selected`;
}

function renderSentences() {
  const visible = state.sentences.filter(s => {
    const haystack = normalizeSearchText([s.recordId,s.hindiSentence,s.chineseSentence,s.pinyin,s.hindiExplanation,s.category,s.tags].join(' '));
    const topicMatch = state.selectedCategories.size === 0 || [...sentenceTopics(s)].some(topic => state.selectedCategories.has(topic));
    return matchesKeywordExpression(haystack) && topicMatch;
  });
  const grid = $('sentenceGrid'); grid.innerHTML = '';
  visible.forEach(s => grid.appendChild(createCard(s)));
  $('resultCount').textContent = `${visible.length} shown`;
  $('emptyState').classList.toggle('hidden', visible.length > 0);
}

function handlePreview() {
  const pastedText = $('pasteInput').value.trim();
  const text = decodeMobileClipboardText(pastedText);
  if (!text) { $('parseMessage').textContent = 'Paste an AI answer first.'; return; }
  if (text !== pastedText) $('pasteInput').value = text;
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
  $('saveMessage').textContent = 'Saving sentence…';
  const submitted = { ...state.preview };
  const beforeIds = new Set(state.sentences.map(s => s.recordId));
  const fields = { action:'create', pin, content:submitted.originalPaste, aiSource:submitted.aiSource };
  const form = document.createElement('form');
  form.method = 'POST'; form.action = API_URL; form.target = 'submissionFrame'; form.hidden = true;
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
      const added = rows.find(row =>
        row.recordId &&
        !beforeIds.has(row.recordId) &&
        row.hindiSentence === submitted.hindiSentence &&
        row.chineseSentence === submitted.chineseSentence &&
        row.pinyin === submitted.pinyin
      );
      if (added) {
        clearInterval(verify); state.sentences = rows;
        $('sentenceCount').textContent = rows.length; renderSentences();
        $('saveMessage').textContent = 'Saved successfully!'; $('confirmSave').disabled = false;
        $('pasteInput').value = ''; $('previewPanel').classList.add('hidden');
        setTimeout(() => { $('pinDialog').close(); $('libraryTitle').scrollIntoView({behavior:'smooth'}); }, 800);
      } else if (checks >= 10) {
        clearInterval(verify); $('confirmSave').disabled = false;
        $('saveMessage').textContent = 'The submission was sent, but confirmation is taking longer than expected. Refresh the page before trying again.';
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

$('startButton').addEventListener('click', () => $('createPrompt').scrollIntoView({behavior:'smooth'}));
$('generatePrompt').addEventListener('click', buildPrompt);
$('promptSentence').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') buildPrompt();
});
$('copyGeneratedPrompt').addEventListener('click', copyPromptText);
$('openChatGPT').addEventListener('click', () => copyAndOpen('https://chatgpt.com/'));
$('openGemini').addEventListener('click', () => copyAndOpen('https://gemini.google.com/app'));
$('sampleButton').addEventListener('click', () => { $('pasteInput').value = SAMPLE; $('pasteInput').focus(); });
$('pasteInput').addEventListener('paste', () => {
  setTimeout(() => {
    const pastedText = $('pasteInput').value;
    const decoded = decodeMobileClipboardText(pastedText);
    if (decoded !== pastedText.trim()) {
      $('pasteInput').value = decoded;
      $('parseMessage').textContent = 'Mobile encoded text was decoded automatically. You can preview it now.';
    }
  }, 0);
});
$('clearButton').addEventListener('click', () => { $('pasteInput').value = ''; $('parseMessage').textContent = ''; $('previewPanel').classList.add('hidden'); });
$('previewButton').addEventListener('click', handlePreview);
['keywordA','keywordB','keywordC'].forEach(id => $(id).addEventListener('input', renderSentences));
['operatorAB','operatorBC'].forEach(id => $(id).addEventListener('change', renderSentences));
$('topicToggle').addEventListener('click', () => {
  const open = !$('topicMenu').classList.contains('hidden');
  $('topicMenu').classList.toggle('hidden', open);
  $('topicToggle').setAttribute('aria-expanded', String(!open));
});
$('topicAll').addEventListener('change', () => {
  const shouldSelectAll = $('topicAll').checked;
  state.selectedCategories = new Set(shouldSelectAll ? state.categories.map(normalizeSearchText) : []);
  $('topicOptions').querySelectorAll('input').forEach(input => { input.checked = shouldSelectAll; });
  updateTopicPicker(); renderSentences();
});
document.addEventListener('click', event => {
  if (!$('topicPicker').contains(event.target)) {
    $('topicMenu').classList.add('hidden');
    $('topicToggle').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('topicMenu').classList.add('hidden');
    $('topicToggle').setAttribute('aria-expanded', 'false');
  }
});
$('helpButton').addEventListener('click', () => $('helpDialog').showModal());
$('copyPrompt').addEventListener('click', async () => {
  await navigator.clipboard.writeText(AI_PROMPT_TEMPLATE.replace('{{STUDENT_SENTENCE}}', '[Paste one Hindi or Romanized Hindi sentence here]'));
  const button = $('copyPrompt'); button.textContent = 'Copied!';
  setTimeout(() => { button.textContent = 'Copy AI prompt'; }, 1400);
});
$('closeHelp').addEventListener('click', () => $('helpDialog').close());
$('helpDialog').addEventListener('click', e => { if (e.target === $('helpDialog')) $('helpDialog').close(); });
$('saveButton').addEventListener('click', openPinDialog);
$('confirmSave').addEventListener('click', submitSentence);
$('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitSentence(); });
$('closePin').addEventListener('click', () => $('pinDialog').close());
loadBank();
