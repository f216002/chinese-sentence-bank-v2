/* ---- Firebase backend (replaces Google Sheets + Apps Script) ----
   Project: my-chinese-sentence-bank-v3 (shared with the v3 site).
   v2 data lives under v2_-prefixed collections/paths so it never
   collides with v3 data. Reads are public; writes need anonymous auth. */
const firebaseConfig = {
  apiKey: "AIzaSyChpInXumwIWaOrR4cU8KhNm1NK5-RdgQw",
  authDomain: "my-chinese-sentence-bank-v3.firebaseapp.com",
  projectId: "my-chinese-sentence-bank-v3",
  storageBucket: "my-chinese-sentence-bank-v3.firebasestorage.app",
  messagingSenderId: "178850974896",
  appId: "1:178850974896:web:f1d40b2ed4e7218b553f75"
};
/* One-time migration still talks to the retired Apps Script backend. */
const OLD_API_URL = 'https://script.google.com/macros/s/AKfycbw9trkW9RNCRSwWou_51Q-FP6aL7Lp8sy3zizSG83fzN1Urtd3ZiMc47RUfHDBTIMJfDw/exec';
const SENTENCES_COL = 'v2_sentences';
const META_COL = 'v2_meta';
const SETTINGS_DOC = 'settings';
const AUDIO_PREFIX = 'v2_audio/';

let fbDb = null, fbAuth = null, fbStorage = null, fbFieldValue = null;
let firebaseInitError = '';
try {
  if (!window.firebase) throw new Error('Firebase SDK failed to load.');
  window.firebase.initializeApp(firebaseConfig);
  fbDb = window.firebase.firestore();
  fbAuth = window.firebase.auth();
  fbStorage = window.firebase.storage();
  fbFieldValue = window.firebase.firestore.FieldValue;
} catch (err) {
  firebaseInitError = (err && err.message) || String(err);
}

let authReadyPromise = null;
function ensureAuth() {
  if (firebaseInitError) return Promise.reject(new Error(firebaseInitError));
  if (!authReadyPromise) {
    authReadyPromise = fbAuth.signInAnonymously().then(cred => cred.user).catch(err => {
      authReadyPromise = null;
      const code = (err && err.code) || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
        throw new Error('Anonymous sign-in is disabled. In the Firebase console, open Authentication → Sign-in method and enable Anonymous.');
      }
      throw err;
    });
  }
  return authReadyPromise;
}

const serverTimestamp = () => fbFieldValue.serverTimestamp();

/* Firestore document -> sentence object used by the UI.
   recordId is the Firestore document id (old Sheet Record IDs are kept as
   document ids during migration, so existing links keep working). */
function docToSentence(id, d) {
  d = d || {};
  const audioPath = d.audioPath || '';
  return {
    recordId: id,
    hindiSentence: d.hindiSentence || '',
    chineseSentence: d.chineseSentence || '',
    pinyin: d.pinyin || '',
    romanHindi: d.romanHindi || '',
    hindiExplanation: d.hindiExplanation || '',
    category: d.category || 'Other',
    tags: d.tags || '',
    aiSource: d.aiSource || '',
    originalPaste: d.originalPaste || '',
    favorite: !!d.favorite,
    audioPath,
    audioMime: d.audioMime || '',
    standardAudioUrl: audioPath, /* truthy marker: existing UI checks keep working */
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
    seq: (d.seq == null ? null : d.seq),
  };
}

/* UI fields -> Firestore document data for a new sentence. */
function sentenceDocData(fields) {
  return {
    hindiSentence: fields.hindiSentence || '',
    chineseSentence: fields.chineseSentence || '',
    pinyin: fields.pinyin || '',
    romanHindi: fields.romanHindi || '',
    hindiExplanation: fields.hindiExplanation || '',
    category: fields.category || 'Other',
    tags: fields.tags || '',
    aiSource: fields.aiSource || '',
    originalPaste: fields.originalPaste || '',
    favorite: false,
    audioPath: '',
    audioMime: '',
    /* 課程內容包順序號：課號 × 100000 ＋ 包內序號；非課程記錄為 null。 */
    seq: (fields.seq == null ? null : fields.seq),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/* 課程記錄按內容包順序號排列（課號×100000＋包內序號）；無序號者維持原相對順序排在後面。 */
function sortSentencesBySeq(list) {
  list.sort((a, b) => {
    const sa = (a.seq == null ? Number.MAX_SAFE_INTEGER : a.seq);
    const sb = (b.seq == null ? Number.MAX_SAFE_INTEGER : b.seq);
    return sa - sb;
  });
  return list;
}

async function reloadSentences() {
  const snap = await fbDb.collection(SENTENCES_COL).get();
  state.sentences = sortSentencesBySeq(snap.docs.map(d => docToSentence(d.id, d.data())));
  $('sentenceCount').textContent = state.sentences.length;
  saveBankCache();
}

/* 課程某課下一個順序號（手動新增補充句子用）。 */
function nextCourseSeq(lessonNum) {
  const base = Number(lessonNum) * 100000;
  let max = 0;
  lessonRecords(lessonNum).forEach(s => {
    if (s.seq != null && s.seq >= base && s.seq < base + 100000) max = Math.max(max, s.seq - base);
  });
  return base + max + 1;
}

function defaultSettings() {
  return {
    bankName: 'My Chinese Sentence Bank',
    ownerName: '',
    defaultVoice: 'zh-TW',
    speechRate: 0.85,
    categories: 'Daily Life, School, Home, Restaurant, Shopping, Bank, Hospital, Travel, Train & Bus, Airport, Work, Friends, Other',
  };
}
const SAMPLE = `HINDI:\nमुझे बैंक से पैसे निकालने हैं।\n\nCHINESE:\n我要去銀行領錢。\n\nPINYIN:\nWǒ yào qù yínháng lǐng qián.\n\nROMAN:\nMujhe bank se paise nikaalne hain.\n\nEXPLANATION:\n我要 (wǒ yào) का अर्थ है “मैं ... करना चाहता/चाहती हूँ।”\n去 (qù) का अर्थ “जाना” है।\n銀行 (yínháng) का अर्थ “बैंक” है।\n領錢 (lǐng qián) का अर्थ बैंक से पैसे निकालना है।\n中文語序 (Zhōngwén yǔxù): 主語 (zhǔyǔ) + 要 (yào) + 去 (qù) + 地點 (dìdiǎn) + 動作 (dòngzuò)。\n\nCATEGORY:\nBank`;
const AI_PROMPT = `You are a Taiwanese Mandarin teacher for a Hindi-speaking beginner. Convert the Hindi sentence below into natural Traditional Chinese used in Taiwan.\n\nHINDI SENTENCE:\n[Paste one Hindi sentence here]\n\nReturn ONLY the following labelled sections. Do not add an introduction or conclusion. Keep every label exactly as written and do not add Markdown symbols such as ** around the labels.\n\nHINDI:\n[Repeat the original Hindi sentence]\n\nCHINESE:\n[One natural Traditional Chinese sentence used in Taiwan]\n\nPINYIN:\n[Hanyu Pinyin with tone marks for the complete Chinese sentence]\n\nEXPLANATION:\n[Explain every Chinese word and the grammar in clear Hindi. Whenever any Chinese character, word, phrase, or example appears, immediately add its pinyin in parentheses. Use Traditional Chinese only.]\n\nCATEGORY:\n[Choose exactly one: Daily Life, School, Home, Restaurant, Shopping, Bank, Hospital, Travel, Train & Bus, Airport, Work, Friends, Other]\n\nTAGS:\n[Three to five short English keywords separated by commas]\n\nAI SOURCE:\n[Write ChatGPT or Gemini]`;
const AI_PROMPT_TEMPLATE = `Role Persona: You are a professional Chinese language teacher whose native language is Hindi. Your students are beginners from India learning Chinese. Conduct all teaching, guidance, and explanations in warm, friendly, and professional Hindi throughout.

Core Task: If I provide Hindi or Romanized Hindi, translate it into natural spoken Traditional Chinese as used in Taiwan. If I provide Chinese, translate it into natural Hindi. Then explain its vocabulary and grammatical structure entirely in Hindi.

Formatting and Output Guidelines: Return exactly the seven section headers below in this order. Put every header on its own line exactly as written, without Markdown symbols such as ** or #. Do not omit any section.

HINDI:
Present the original Hindi sentence in full. If the input is Romanized Hindi, convert it into correct Devanagari Hindi.

CHINESE:
Provide an accurate, authentic Traditional Chinese translation using Traditional Chinese characters exclusively.

PINYIN:
Provide the complete Hanyu Pinyin with correct tone marks and punctuation.

ROMAN:
Provide the complete Romanized transliteration in Latin script for the Hindi sentence.

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
const sentenceModelAudio = new Audio();
const teacherAudioCache = new Map();
const cardRecordings = new Map();
let activeCardRecorder = null;
let activeCardStream = null;
let activeCardButton = null;
let pendingModelSave = null;
let pendingDeleteSentence = null;
let pendingEditSentence = null;
let pendingSuppLesson = null; /* 新增補充分頁句子時：目標課號；編輯既有記錄時為 null */

function parsePaste(text) {
  const labels = ['HINDI', 'CHINESE', 'PINYIN', 'ROMAN', 'EXPLANATION', 'CATEGORY', 'TAGS', 'AI SOURCE', 'LESSON', 'SECTION', 'SPEAKER', 'POS', 'ZHUYIN'];
  const found = {};
  /* The whitespace after a label excludes newlines: an empty-valued label must
     not swallow the line break, otherwise the next line's label is missed and
     its text becomes this field's value. */
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?\\s*(${labels.join('|')})[ \\t]*:?[ \\t]*(?:\\*\\*)?[ \\t]*:?[ \\t]*`, 'gi');
  const matches = [...text.matchAll(pattern)];
  matches.forEach((match, index) => {
    const key = match[1].toUpperCase();
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    found[key] = text.slice(start, end).trim();
  });
  return {
    hindiSentence: found.HINDI || '', chineseSentence: found.CHINESE || '',
    pinyin: found.PINYIN || '', romanHindi: found.ROMAN || '', hindiExplanation: found.EXPLANATION || '',
    category: found.CATEGORY || 'Other', tags: found.TAGS || '',
    aiSource: found['AI SOURCE'] || 'ChatGPT / Gemini', originalPaste: text,
    lesson: found.LESSON || '', section: found.SECTION || '', speaker: found.SPEAKER || '',
    pos: found.POS || '', zhuyin: found.ZHUYIN || ''
  };
}

function buildPrompt() {
  const sentence = $('promptSentence').value.trim();
  if (!sentence) {
    $('promptMessage').textContent = 'Type one Hindi, Romanized Hindi, or Chinese sentence first.';
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

function romanHindiFor(sentence) {
  if (sentence.romanHindi) return sentence.romanHindi;
  if (!sentence.originalPaste) return '';
  return parsePaste(sentence.originalPaste).romanHindi;
}

function setModelAudioStatus(button, message) {
  const card = button.closest('.sentence-card');
  const status = card && card.querySelector('.card-recording-status');
  if (status) status.textContent = message;
}

function playTeacherAudioUrl(audioUrl, button) {
  sentenceModelAudio.pause();
  sentenceModelAudio.currentTime = 0;
  sentenceModelAudio.src = audioUrl;
  button.classList.add('speaking');
  setModelAudioStatus(button, 'Playing the teacher recording…');
  sentenceModelAudio.onended = () => {
    button.classList.remove('speaking');
    setModelAudioStatus(button, 'Teacher recording finished.');
  };
  sentenceModelAudio.onerror = () => {
    button.classList.remove('speaking');
    setModelAudioStatus(button, 'The teacher recording could not be played.');
  };
  sentenceModelAudio.play().catch(() => {
    button.classList.remove('speaking');
    setModelAudioStatus(button, 'Tap the play button again to hear the teacher recording.');
  });
}

async function playSentenceModel(sentence, button) {
  if (!sentence.standardAudioUrl) {
    speakChinese(sentence.chineseSentence, button);
    return;
  }

  const cachedUrl = teacherAudioCache.get(sentence.recordId);
  if (cachedUrl) {
    playTeacherAudioUrl(cachedUrl, button);
    return;
  }

  button.disabled = true;
  setModelAudioStatus(button, 'Loading the teacher recording…');
  try {
    const url = await fbStorage.ref(sentence.audioPath || sentence.standardAudioUrl).getDownloadURL();
    teacherAudioCache.set(sentence.recordId, url);
    button.disabled = false;
    playTeacherAudioUrl(url, button);
  } catch (_) {
    button.disabled = false;
    setModelAudioStatus(button, 'Teacher recording unavailable.');
  }
}

async function getNaturalVoiceStream() {
  const supported = navigator.mediaDevices.getSupportedConstraints
    ? navigator.mediaDevices.getSupportedConstraints()
    : {};
  const audio = {};
  ['autoGainControl', 'echoCancellation', 'noiseSuppression'].forEach(name => {
    if (supported[name]) audio[name] = {exact:false};
  });
  if (supported.channelCount) audio.channelCount = {ideal:1};
  if (supported.sampleRate) audio.sampleRate = {ideal:48000};
  if (supported.sampleSize) audio.sampleSize = {ideal:16};

  try {
    return await navigator.mediaDevices.getUserMedia({audio});
  } catch (error) {
    if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) throw error;
    ['autoGainControl', 'echoCancellation', 'noiseSuppression'].forEach(name => {
      if (supported[name]) audio[name] = {ideal:false};
    });
    return navigator.mediaDevices.getUserMedia({audio});
  }
}

function createVoiceRecorder(stream) {
  try {
    return new MediaRecorder(stream, {audioBitsPerSecond:128000});
  } catch (_) {
    return new MediaRecorder(stream);
  }
}

function audioBufferPeak(audioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const samples = audioBuffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
  }
  return peak;
}

async function kWeightedBuffer(audioBuffer) {
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) return audioBuffer;
  const context = new OfflineContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  const source = context.createBufferSource();
  source.buffer = audioBuffer;

  // Web Audio approximation of the ITU-R BS.1770 K-weighting filters.
  const shelf = context.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1681.974;
  shelf.gain.value = 4;

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 38.135;
  highpass.Q.value = 0.5003;

  source.connect(shelf);
  shelf.connect(highpass);
  highpass.connect(context.destination);
  source.start();
  return context.startRendering();
}

function blockEnergy(audioBuffer, start, length) {
  let energy = 0;
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const samples = audioBuffer.getChannelData(channel);
    const end = Math.min(samples.length, start + length);
    let channelEnergy = 0;
    for (let index = start; index < end; index += 1) {
      channelEnergy += samples[index] * samples[index];
    }
    energy += channelEnergy / Math.max(1, end - start);
  }
  return energy;
}

function energyToLufs(energy) {
  return -0.691 + 10 * Math.log10(Math.max(energy, 1e-12));
}

function measureIntegratedLufs(audioBuffer) {
  const blockLength = Math.max(1, Math.round(audioBuffer.sampleRate * 0.4));
  const step = Math.max(1, Math.round(audioBuffer.sampleRate * 0.1));
  const energies = [];
  if (audioBuffer.length <= blockLength) {
    energies.push(blockEnergy(audioBuffer, 0, audioBuffer.length));
  } else {
    for (let start = 0; start + blockLength <= audioBuffer.length; start += step) {
      energies.push(blockEnergy(audioBuffer, start, blockLength));
    }
  }

  const aboveAbsoluteGate = energies.filter(energy => energyToLufs(energy) > -70);
  if (!aboveAbsoluteGate.length) return -70;
  const preliminaryEnergy = aboveAbsoluteGate.reduce((sum, value) => sum + value, 0) / aboveAbsoluteGate.length;
  const relativeGate = energyToLufs(preliminaryEnergy) - 10;
  const gated = aboveAbsoluteGate.filter(energy => energyToLufs(energy) > relativeGate);
  const integratedEnergy = gated.reduce((sum, value) => sum + value, 0) / Math.max(1, gated.length);
  return energyToLufs(integratedEnergy);
}

function encodeMonoWav(audioBuffer, gain) {
  const length = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;
  const output = new ArrayBuffer(44 + length * 2);
  const view = new DataView(output);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, length * 2, true);

  const channels = Array.from(
    {length: channelCount},
    (_, channel) => audioBuffer.getChannelData(channel)
  );
  let offset = 44;
  for (let index = 0; index < length; index += 1) {
    let sample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sample += channels[channel][index];
    }
    sample = (sample / channelCount) * gain;
    sample = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([output], {type:'audio/wav'});
}

async function normalizeTeacherRecording(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return {blob, mimeType:blob.type || 'audio/webm', normalized:false};
  const context = new AudioContextClass();
  try {
    const audioBuffer = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const weighted = await kWeightedBuffer(audioBuffer);
    const measuredLufs = measureIntegratedLufs(weighted);
    const peak = audioBufferPeak(audioBuffer);
    if (!Number.isFinite(measuredLufs) || peak <= 0) {
      return {blob, mimeType:blob.type || 'audio/webm', normalized:false};
    }

    const targetGain = Math.pow(10, (-16 - measuredLufs) / 20);
    const peakLimit = Math.pow(10, -1 / 20) / peak;
    // Never add more than 18 dB. The -1 dBFS ceiling always has priority.
    const gain = Math.max(0.01, Math.min(targetGain, peakLimit, Math.pow(10, 18 / 20)));
    const normalizedBlob = encodeMonoWav(audioBuffer, gain);
    const resultingLufs = measuredLufs + 20 * Math.log10(gain);
    return {
      blob: normalizedBlob,
      mimeType: 'audio/wav',
      normalized: true,
      measuredLufs,
      resultingLufs
    };
  } finally {
    await context.close();
  }
}

async function toggleCardRecording(node, sentence, preview) {
  const recordButton = node.querySelector('.card-record-button');
  const playButton = node.querySelector('.card-play-button');
  const saveButton = node.querySelector('.card-save-model-button');
  const status = node.querySelector('.card-recording-status');

  if (activeCardRecorder && activeCardRecorder.state === 'recording') {
    if (activeCardButton !== recordButton) {
      status.textContent = 'Another card is recording. Stop it first.';
      return;
    }
    activeCardRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    status.textContent = 'Recording is not supported here. Try Chrome, Edge, or Safari.';
    return;
  }

  try {
    const stream = await getNaturalVoiceStream();
    const chunks = [];
    const recorder = createVoiceRecorder(stream);
    activeCardRecorder = recorder;
    activeCardStream = stream;
    activeCardButton = recordButton;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      const rawBlob = new Blob(chunks, {type:recorder.mimeType || 'audio/webm'});
      status.textContent = 'Balancing recording volume…';
      let processed = {blob:rawBlob, mimeType:rawBlob.type || 'audio/webm', normalized:false};
      try {
        processed = await normalizeTeacherRecording(rawBlob);
      } catch (error) {
        console.warn('Teacher recording normalization failed; using original audio.', error);
      }
      const key = sentence.recordId || `preview-${sentence.chineseSentence}`;
      const previous = cardRecordings.get(key);
      if (previous && previous.url) URL.revokeObjectURL(previous.url);
      const recording = {
        blob: processed.blob,
        url: URL.createObjectURL(processed.blob),
        mimeType: processed.mimeType
      };
      cardRecordings.set(key, recording);
      playButton.disabled = false;
      saveButton.disabled = preview || !sentence.recordId;
      recordButton.classList.remove('recording');
      recordButton.textContent = '● Record again';
      status.textContent = processed.normalized
        ? 'Recording ready. Volume balanced to about -16 LUFS with -1 dB peak protection.'
        : 'Recording ready. Original audio was kept.';
      activeCardRecorder = null;
      activeCardStream = null;
      activeCardButton = null;
    };
    recorder.start();
    recordButton.classList.add('recording');
    recordButton.textContent = '■ Stop recording';
    status.textContent = 'Recording… Automatic volume control is off. Keep a steady distance from the microphone.';
    setTimeout(() => {
      if (activeCardRecorder === recorder && recorder.state === 'recording') recorder.stop();
    }, 30000);
  } catch (_) {
    status.textContent = 'Microphone permission was not allowed.';
  }
}

function recordingForSentence(sentence) {
  return cardRecordings.get(sentence.recordId || `preview-${sentence.chineseSentence}`);
}

function openAudioPinDialog(sentence, node) {
  const recording = recordingForSentence(sentence);
  if (!recording || !sentence.recordId) return;
  pendingModelSave = {sentence, node, recording};
  try { $('audioPinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
  $('audioSaveMessage').textContent = '';
  $('audioPinDialog').showModal();
  setTimeout(() => $('audioPinInput').focus(), 50);
}

async function submitTeacherAudio() {
  const pin = $('audioPinInput').value.trim();
  if (!pin) { $('audioSaveMessage').textContent = 'Enter the teacher PIN.'; return; }
  if (!pendingModelSave) { $('audioPinDialog').close(); return; }
  const {sentence, recording} = pendingModelSave;
  const button = $('confirmAudioSave');
  button.disabled = true;
  $('audioSaveMessage').textContent = 'Uploading the teacher recording…';
  try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {}

  try {
    await ensureAuth();
    const mime = recording.mimeType || 'audio/webm';
    const ext = mime.includes('mp4') ? 'm4a' : 'webm';
    const path = `${AUDIO_PREFIX}${sentence.recordId}.${ext}`;
    await fbStorage.ref(path).put(recording.blob, { contentType: mime });
    await fbDb.collection(SENTENCES_COL).doc(sentence.recordId).update({
      audioPath: path,
      audioMime: mime,
      updatedAt: serverTimestamp(),
    });
    const saved = state.sentences.find(row => row.recordId === sentence.recordId);
    if (saved) { saved.audioPath = path; saved.audioMime = mime; saved.standardAudioUrl = path; }
    teacherAudioCache.delete(sentence.recordId);
    renderSentences();
    $('audioSaveMessage').textContent = 'Teacher recording saved! The model button now uses your voice.';
    button.disabled = false;
    setTimeout(() => $('audioPinDialog').close(), 1300);
  } catch (err) {
    button.disabled = false;
    $('audioSaveMessage').textContent = `Save failed: ${(err && err.message) || 'Unknown error.'}`;
  }
}

function openDeleteDialog(sentence) {
  if (!sentence.recordId) return;
  pendingDeleteSentence = sentence;
  $('deleteSentenceText').textContent = sentence.chineseSentence || sentence.hindiSentence || 'Untitled sentence';
  $('deleteRecordId').textContent = sentence.recordId;
  try { $('deletePinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
  $('deleteMessage').textContent = '';
  $('confirmDelete').disabled = false;
  $('deleteDialog').showModal();
  setTimeout(() => $('deletePinInput').focus(), 50);
}

async function submitDeleteSentence() {
  const pin = $('deletePinInput').value.trim();
  if (!pin) { $('deleteMessage').textContent = 'Enter the teacher PIN.'; return; }
  if (!pendingDeleteSentence) { $('deleteDialog').close(); return; }

  const sentence = pendingDeleteSentence;
  const button = $('confirmDelete');
  button.disabled = true;
  $('deleteMessage').textContent = 'Deleting sentence…';
  try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {}

  try {
    await ensureAuth();
    if (sentence.audioPath) {
      try { await fbStorage.ref(sentence.audioPath).delete(); } catch (_) { /* already gone */ }
    }
    teacherAudioCache.delete(sentence.recordId);
    await fbDb.collection(SENTENCES_COL).doc(sentence.recordId).delete();
    state.sentences = state.sentences.filter(row => row.recordId !== sentence.recordId);
    $('sentenceCount').textContent = state.sentences.length;
    renderSentences();
    renderCourse(); /* 課程課文分頁也要即時重繪，避免刪掉的卡片殘留 */
    pendingDeleteSentence = null;
    $('deleteMessage').textContent = 'Sentence deleted.';
    setTimeout(() => $('deleteDialog').close(), 650);
  } catch (err) {
    button.disabled = false;
    $('deleteMessage').textContent = `Delete failed: ${(err && err.message) || 'Unknown error.'}`;
  }
}

/* Edit sentence: rebuild the record through create + delete, because the
   backend has no update action. The old record is removed only after the
   new version is confirmed saved. */
function openEditDialog(sentence) {
  if (!sentence.recordId) return;
  pendingEditSentence = sentence;
  $('editHindi').value = sentence.hindiSentence || '';
  $('editChinese').value = sentence.chineseSentence || '';
  $('editPinyin').value = sentence.pinyin || '';
  $('editRoman').value = romanHindiFor(sentence);
  $('editExplanation').value = sentence.hindiExplanation || '';
  $('editCategory').value = sentence.category || 'Other';
  $('editTags').value = sentence.tags || '';
  $('editAiSource').value = sentence.aiSource || 'ChatGPT / Gemini';
  const list = $('editCategoryList');
  list.innerHTML = '';
  (state.categories || []).forEach(c => {
    const option = document.createElement('option');
    option.value = c;
    list.appendChild(option);
  });
  $('editRecordNote').textContent = `Editing record ${sentence.recordId}. Changes update this record in place; any teacher recording stays attached.`;
  const hasAudio = !!(sentence.standardAudioUrl || teacherAudioCache.get(sentence.recordId) || recordingForSentence(sentence));
  $('editAudioNote').classList.toggle('hidden', !hasAudio);
  try { $('editPinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
  $('editMessage').textContent = '';
  $('confirmEdit').disabled = false;
  $('confirmEdit').textContent = 'Save changes';
  pendingSuppLesson = null;
  updateEditWarnings();
  $('editDialog').showModal();
  setTimeout(() => $('editHindi').focus(), 50);
}

/* 新增補充句子：借用同一個編輯對話框，但走「建立」流程，不刪除舊記錄。 */
function openSuppDialog(lessonNum) {
  pendingEditSentence = null;
  pendingSuppLesson = lessonNum;
  $('editHindi').value = '';
  $('editChinese').value = '';
  $('editPinyin').value = '';
  $('editRoman').value = '';
  $('editExplanation').value = '';
  $('editCategory').value = '課程';
  $('editTags').value = `${lessonShortLabel(lessonNum)}, 補充`;
  $('editAiSource').value = '老師補充';
  const list = $('editCategoryList');
  list.innerHTML = '';
  (state.categories || []).forEach(c => {
    const option = document.createElement('option');
    option.value = c;
    list.appendChild(option);
  });
  $('editRecordNote').textContent = `為${lessonShortLabel(lessonNum)}新增補充句子，儲存後會出現在「補充」分頁。`;
  $('editAudioNote').classList.add('hidden');
  try { $('editPinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
  $('editMessage').textContent = '';
  $('confirmEdit').disabled = false;
  $('confirmEdit').textContent = '新增補充句子';
  updateEditWarnings();
  $('editDialog').showModal();
  setTimeout(() => $('editHindi').focus(), 50);
}

function updateEditWarnings() {
  const box = $('editWarnings');
  const warnings = [];
  const pinyinText = $('editPinyin').value.trim();
  const pinyinIssues = validatePinyin(pinyinText);
  pinyinIssues.slice(0, 8).forEach(issue => warnings.push(`Pinyin: ${issue}.`));
  if (pinyinIssues.length > 8) warnings.push(`…and ${pinyinIssues.length - 8} more pinyin issues.`);
  if (pinyinText && !/^[A-ZĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/.test(pinyinText)) warnings.push('Pinyin: the first syllable usually starts with a capital letter.');
  const chinese = $('editChinese').value.trim();
  const hindi = $('editHindi').value.trim();
  const excludeId = pendingEditSentence ? pendingEditSentence.recordId : null;
  if (chinese) {
    const exactDupe = state.sentences.find(s => s.recordId !== excludeId && (s.chineseSentence || '').trim() === chinese);
    if (exactDupe) warnings.push(`This Chinese sentence already exists as another record${exactDupe.recordId ? ` (${exactDupe.recordId})` : ''}. Saving is blocked until you change it.`);
  }
  if (hindi) {
    const hindiDupe = state.sentences.find(s => s.recordId !== excludeId && (s.hindiSentence || '').trim() === hindi && (s.chineseSentence || '').trim() !== chinese);
    if (hindiDupe) warnings.push(`The same Hindi sentence already exists with a different Chinese translation${hindiDupe.recordId ? ` (${hindiDupe.recordId})` : ''}. Check which version is correct before saving.`);
  }
  if (!warnings.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '<strong>Please check before saving:</strong>';
  const list = document.createElement('ul');
  warnings.forEach(w => { const li = document.createElement('li'); li.textContent = w; list.appendChild(li); });
  box.appendChild(list);
}

function buildEditedPaste() {
  const lines = [
    ['HINDI', $('editHindi').value.trim()],
    ['CHINESE', $('editChinese').value.trim()],
    ['PINYIN', $('editPinyin').value.trim()],
    ['ROMAN', $('editRoman').value.trim()],
    ['EXPLANATION', $('editExplanation').value.trim()],
    ['CATEGORY', $('editCategory').value.trim() || 'Other'],
    ['TAGS', $('editTags').value.trim()],
    ['AI SOURCE', $('editAiSource').value.trim() || 'ChatGPT / Gemini'],
  ];
  /* Keep course labels so editing a lesson record does not drop it from the course view. */
  if (pendingSuppLesson) {
    lines.push(['LESSON', String(pendingSuppLesson)]);
    lines.push(['SECTION', '補充']);
  } else if (pendingEditSentence) {
    const meta = courseMeta(pendingEditSentence);
    if (meta.lesson) lines.push(['LESSON', meta.lesson]);
    if (meta.section) lines.push(['SECTION', meta.section]);
    if (meta.speaker) lines.push(['SPEAKER', meta.speaker]);
    if (meta.pos) lines.push(['POS', meta.pos]);
    if (meta.zhuyin) lines.push(['ZHUYIN', meta.zhuyin]);
  }
  return lines.map(([label, value]) => `${label}: ${value}`).join('\n');
}

/* Edit sentence: Firebase supports true in-place updates, so editing keeps the
   same recordId and any attached teacher recording. New "補充" sentences
   still create a fresh record. */
async function submitEdit() {
  const pin = $('editPinInput').value.trim();
  if (!pin) { $('editMessage').textContent = 'Enter the teacher PIN.'; return; }
  if (!pendingEditSentence && !pendingSuppLesson) { $('editDialog').close(); return; }
  const original = pendingEditSentence; /* null = 新增補充句子 */
  const isCreate = !original;
  const edited = {
    hindiSentence: $('editHindi').value.trim(),
    chineseSentence: $('editChinese').value.trim(),
    pinyin: $('editPinyin').value.trim(),
    romanHindi: $('editRoman').value.trim(),
    hindiExplanation: $('editExplanation').value.trim(),
  };
  const missing = [['Hindi', edited.hindiSentence], ['Chinese', edited.chineseSentence], ['Pinyin', edited.pinyin], ['Roman', edited.romanHindi], ['Explanation', edited.hindiExplanation]]
    .filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) { $('editMessage').textContent = `Please fill in: ${missing.join(', ')}.`; return; }
  const exactDupe = state.sentences.find(s => s.recordId !== (original && original.recordId) && (s.chineseSentence || '').trim() === edited.chineseSentence);
  if (exactDupe) { $('editMessage').textContent = `Blocked: this Chinese sentence already exists as record ${exactDupe.recordId || 'another record'}.`; return; }

  const button = $('confirmEdit');
  button.disabled = true;
  $('editMessage').textContent = isCreate ? '新增補充句子…' : 'Saving changes…';
  try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {}

  const content = buildEditedPaste();
  const data = sentenceDocData({
    ...edited,
    category: $('editCategory').value.trim() || 'Other',
    tags: $('editTags').value.trim(),
    aiSource: $('editAiSource').value.trim() || 'ChatGPT / Gemini',
    originalPaste: content,
    /* 新增補充句子接在該課最後；原地編輯保留原順序號。 */
    seq: isCreate ? nextCourseSeq(pendingSuppLesson) : (original.seq != null ? original.seq : null),
  });

  try {
    await ensureAuth();
    if (isCreate) {
      /* 新增補充句子：建立新記錄。 */
      await fbDb.collection(SENTENCES_COL).add(data);
      await reloadSentences();
      courseMetaCache.clear();
      renderSentences();
      renderCourse();
      pendingSuppLesson = null;
      $('editMessage').textContent = '已新增補充句子。';
      setTimeout(() => { $('editDialog').close(); $('confirmEdit').textContent = 'Save changes'; }, 700);
    } else {
      /* 原地更新：保留 recordId、建立時間與錄音，只換內容欄位。 */
      const { createdAt, audioPath, audioMime, favorite, ...contentFields } = data;
      await fbDb.collection(SENTENCES_COL).doc(original.recordId).update(contentFields);
      await reloadSentences();
      courseMetaCache.clear();
      renderSentences();
      renderCourse();
      pendingEditSentence = null;
      $('editMessage').textContent = 'Changes saved.';
      setTimeout(() => $('editDialog').close(), 700);
    }
  } catch (err) {
    button.disabled = false;
    $('editMessage').textContent = `Save failed: ${(err && err.message) || 'Unknown error.'}`;
  }
}

function createCard(sentence, preview = false) {
  const node = $('cardTemplate').content.firstElementChild.cloneNode(true);
  node.querySelector('.category-pill').textContent = sentence.category || 'Other';
  node.querySelector('.record-id').textContent = preview ? 'PREVIEW' : sentence.recordId || '';
  const deleteButton = node.querySelector('.card-delete-button');
  deleteButton.hidden = preview;
  if (!preview) deleteButton.addEventListener('click', () => openDeleteDialog(sentence));
  const editButton = node.querySelector('.card-edit-button');
  editButton.hidden = preview;
  if (!preview) editButton.addEventListener('click', () => openEditDialog(sentence));
  const hindiEl = node.querySelector('.hindi');
  hindiEl.textContent = sentence.hindiSentence;
  hindiEl.setAttribute('lang', 'hi');
  const hindiSpeak = node.querySelector('.hindi-speak-button');
  hindiSpeak.addEventListener('click', () => speakHindi(sentence.hindiSentence, hindiSpeak));
  const roman = romanHindiFor(sentence);
  const romanLine = node.querySelector('.roman-hindi');
  romanLine.textContent = roman ? `Roman Hindi: ${roman}` : '';
  romanLine.hidden = !roman;
  romanLine.setAttribute('lang', 'hi-Latn');
  const chineseEl = node.querySelector('.chinese');
  chineseEl.textContent = sentence.chineseSentence;
  chineseEl.setAttribute('lang', 'zh-Hant');
  node.querySelector('.pinyin').textContent = sentence.pinyin;
  const explanationEl = node.querySelector('.explanation');
  explanationEl.textContent = sentence.hindiExplanation || 'No explanation added.';
  explanationEl.setAttribute('lang', 'hi');
  const tags = [...new Set(String(sentence.tags || '').split(/[,;|]/).map(t => t.trim().toLowerCase()).filter(Boolean))];
  node.querySelector('.tags').innerHTML = tags.map(tag => `<span class="tag"></span>`).join('');
  node.querySelectorAll('.tag').forEach((el, i) => { el.textContent = tags[i]; });
  const speak = node.querySelector('.speak-button');
  speak.title = sentence.standardAudioUrl ? 'Play teacher model voice' : 'Play browser voice';
  speak.addEventListener('click', () => playSentenceModel(sentence, speak));
  const recordButton = node.querySelector('.card-record-button');
  const playButton = node.querySelector('.card-play-button');
  const saveModelButton = node.querySelector('.card-save-model-button');
  recordButton.addEventListener('click', () => toggleCardRecording(node, sentence, preview));
  playButton.addEventListener('click', () => {
    const recording = recordingForSentence(sentence);
    if (recording) new Audio(recording.url).play();
  });
  saveModelButton.addEventListener('click', () => openAudioPinDialog(sentence, node));
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

function speakHindi(text, button) {
  if (!('speechSynthesis' in window)) return alert('Speech is not supported in this browser. Please try Chrome, Edge or Safari.');
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'hi-IN';
  utterance.rate = 0.85;
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.lang.toLowerCase() === 'hi-in') || voices.find(v => v.lang.toLowerCase().startsWith('hi')) || null;
  utterance.onstart = () => button.classList.add('speaking');
  utterance.onend = utterance.onerror = () => button.classList.remove('speaking');
  speechSynthesis.speak(utterance);
}

/* Pronunciation Lab: listening, recording, pitch direction and homophones. */
const toneModels = {
  1: { text:'媽', curve:[0.78,0.79,0.78,0.79,0.78] },
  2: { text:'麻', curve:[0.28,0.36,0.49,0.65,0.82] },
  3: { text:'馬', curve:[0.55,0.36,0.24,0.38,0.68] },
  4: { text:'罵', curve:[0.84,0.67,0.49,0.31,0.17] }
};

const homophoneFamilies = {
  shi4: [
    {char:'是',pinyin:'shì',meaning:'to be / होना',word:'是的',wordPinyin:'shì de',wordMeaning:'yes'},
    {char:'事',pinyin:'shì',meaning:'matter / बात',word:'事情',wordPinyin:'shìqing',wordMeaning:'matter; event'},
    {char:'市',pinyin:'shì',meaning:'market / बाज़ार',word:'市場',wordPinyin:'shìchǎng',wordMeaning:'market'},
    {char:'室',pinyin:'shì',meaning:'room / कमरा',word:'教室',wordPinyin:'jiàoshì',wordMeaning:'classroom'},
    {char:'試',pinyin:'shì',meaning:'test; try / परीक्षा; कोशिश',word:'考試',wordPinyin:'kǎoshì',wordMeaning:'exam'},
    {char:'式',pinyin:'shì',meaning:'form; pattern / रूप',word:'方式',wordPinyin:'fāngshì',wordMeaning:'method; way'},
    {char:'世',pinyin:'shì',meaning:'world; generation / संसार',word:'世界',wordPinyin:'shìjiè',wordMeaning:'world'},
    {char:'視',pinyin:'shì',meaning:'to see; to view / देखना',word:'電視',wordPinyin:'diànshì',wordMeaning:'television'}
  ],
  yi4: [
    {char:'意',pinyin:'yì',meaning:'meaning; idea / अर्थ; विचार',word:'意思',wordPinyin:'yìsi',wordMeaning:'meaning'},
    {char:'易',pinyin:'yì',meaning:'easy; change / आसान; बदलना',word:'容易',wordPinyin:'róngyì',wordMeaning:'easy'},
    {char:'義',pinyin:'yì',meaning:'justice; meaning / न्याय; अर्थ',word:'意義',wordPinyin:'yìyì',wordMeaning:'significance'},
    {char:'藝',pinyin:'yì',meaning:'art; skill / कला',word:'藝術',wordPinyin:'yìshù',wordMeaning:'art'},
    {char:'議',pinyin:'yì',meaning:'discuss / चर्चा',word:'建議',wordPinyin:'jiànyì',wordMeaning:'suggestion'},
    {char:'憶',pinyin:'yì',meaning:'remember / स्मरण',word:'回憶',wordPinyin:'huíyì',wordMeaning:'memory'},
    {char:'異',pinyin:'yì',meaning:'different / अलग',word:'差異',wordPinyin:'chāyì',wordMeaning:'difference'},
    {char:'億',pinyin:'yì',meaning:'one hundred million / दस करोड़',word:'一億',wordPinyin:'yí yì',wordMeaning:'100 million'}
  ],
  gong1: [
    {char:'工',pinyin:'gōng',meaning:'work / काम',word:'工作',wordPinyin:'gōngzuò',wordMeaning:'work'},
    {char:'公',pinyin:'gōng',meaning:'public / सार्वजनिक',word:'公園',wordPinyin:'gōngyuán',wordMeaning:'park'},
    {char:'功',pinyin:'gōng',meaning:'achievement / उपलब्धि',word:'成功',wordPinyin:'chénggōng',wordMeaning:'succeed'},
    {char:'宮',pinyin:'gōng',meaning:'palace / महल',word:'故宮',wordPinyin:'Gùgōng',wordMeaning:'Palace Museum'},
    {char:'供',pinyin:'gōng',meaning:'provide / प्रदान करना',word:'提供',wordPinyin:'tígōng',wordMeaning:'provide'},
    {char:'攻',pinyin:'gōng',meaning:'attack / हमला',word:'攻擊',wordPinyin:'gōngjí',wordMeaning:'attack'},
    {char:'弓',pinyin:'gōng',meaning:'bow / धनुष',word:'弓箭',wordPinyin:'gōngjiàn',wordMeaning:'bow and arrow'},
    {char:'恭',pinyin:'gōng',meaning:'respectful / आदरपूर्ण',word:'恭喜',wordPinyin:'gōngxǐ',wordMeaning:'congratulations'}
  ]
};

const contextQuestions = [
  {sentence:'我＿＿學生。',pinyin:'Wǒ shì xuéshēng.',options:['是','事','市','試'],answer:'是',explain:'是 (shì) means “to be”: I am a student.'},
  {sentence:'我明天要考＿＿。',pinyin:'Wǒ míngtiān yào kǎoshì.',options:['室','試','市','事'],answer:'試',explain:'考試 (kǎoshì) is the complete word for “exam”.'},
  {sentence:'老師在教＿＿。',pinyin:'Lǎoshī zài jiàoshì.',options:['是','世','室','視'],answer:'室',explain:'教室 (jiàoshì) means “classroom”.'},
  {sentence:'這個字是什麼＿＿思？',pinyin:'Zhège zì shì shénme yìsi?',options:['意','易','藝','議'],answer:'意',explain:'意思 (yìsi) means “meaning”.'},
  {sentence:'謝謝你的建＿＿。',pinyin:'Xièxie nǐ de jiànyì.',options:['憶','議','義','億'],answer:'議',explain:'建議 (jiànyì) means “suggestion”.'},
  {sentence:'他在銀行＿＿作。',pinyin:'Tā zài yínháng gōngzuò.',options:['工','公','功','宮'],answer:'工',explain:'工作 (gōngzuò) means “work”.'}
];

let recorder = null;
let recordedChunks = [];
let recordedUrl = '';
let quizIndex = 0;
let quizAnswered = 0;
let quizCorrect = 0;
const standardToneAudio = new Audio();
let activeToneButton = null;

function speakLabText(text, button) {
  const original = button && button.textContent;
  speakChinese(text, button || document.createElement('button'));
  if (button) {
    button.textContent = '♪ Playing';
    setTimeout(() => { button.textContent = original; }, 1200);
  }
}

function resetToneAudioButton() {
  if (!activeToneButton) return;
  activeToneButton.textContent = activeToneButton.dataset.label;
  activeToneButton.classList.remove('playing');
  activeToneButton = null;
}

function playStandardTone(src, button, fallbackText) {
  standardToneAudio.pause();
  standardToneAudio.currentTime = 0;
  resetToneAudioButton();
  if (!button.dataset.label) button.dataset.label = button.textContent;
  activeToneButton = button;
  button.textContent = '♪ Playing';
  button.classList.add('playing');
  standardToneAudio.src = src;
  standardToneAudio.play().catch(() => {
    resetToneAudioButton();
    speakLabText(fallbackText, button);
  });
}

standardToneAudio.addEventListener('ended', resetToneAudioButton);
standardToneAudio.addEventListener('error', resetToneAudioButton);

function showLabPanel(panel) {
  const tone = panel === 'tone';
  $('tonePractice').classList.toggle('hidden', !tone);
  $('homophonePractice').classList.toggle('hidden', tone);
  $('toneTab').classList.toggle('active', tone);
  $('homophoneTab').classList.toggle('active', !tone);
  $('toneTab').setAttribute('aria-selected', String(tone));
  $('homophoneTab').setAttribute('aria-selected', String(!tone));
}

function drawPitch(reference, student = []) {
  const canvas = $('pitchCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 30;
  ctx.clearRect(0,0,w,h); ctx.fillStyle = '#fffaf2'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = '#dedbd2'; ctx.lineWidth = 1;
  for (let i=1;i<5;i++) { const y=pad+(h-pad*2)*i/5; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); }
  const line = (values,color,width) => {
    if (!values.length) return;
    ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath();
    values.forEach((v,i) => { const x=pad+(w-pad*2)*(i/(values.length-1||1)); const y=h-pad-v*(h-pad*2); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.stroke();
  };
  line(reference,'#0b706b',7); line(student,'#d94a36',4);
}

function autocorrelate(buffer, sampleRate) {
  let rms=0; for (let i=0;i<buffer.length;i++) rms+=buffer[i]*buffer[i]; rms=Math.sqrt(rms/buffer.length);
  if (rms < 0.012) return -1;
  let bestOffset=-1, bestCorrelation=0;
  const minOffset=Math.floor(sampleRate/450), maxOffset=Math.min(Math.floor(sampleRate/70),buffer.length-1);
  for (let offset=minOffset;offset<=maxOffset;offset++) {
    let corr=0; for (let i=0;i<buffer.length-offset;i++) corr+=buffer[i]*buffer[i+offset];
    corr/=buffer.length-offset;
    if (corr>bestCorrelation) { bestCorrelation=corr; bestOffset=offset; }
  }
  return bestCorrelation>0.005 ? sampleRate/bestOffset : -1;
}

async function analyseRecording(blob) {
  const data = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await audioCtx.decodeAudioData(data.slice(0));
  const samples = audio.getChannelData(0), windowSize=2048, step=Math.max(512,Math.floor(samples.length/60));
  const pitches=[];
  for (let start=0;start+windowSize<samples.length;start+=step) {
    const pitch=autocorrelate(samples.subarray(start,start+windowSize),audio.sampleRate);
    if (pitch>70&&pitch<450) pitches.push(pitch);
  }
  await audioCtx.close();
  if (pitches.length<3) throw new Error('Not enough clear voice was detected.');
  const sorted=[...pitches].sort((a,b)=>a-b), low=sorted[Math.floor(sorted.length*.1)], high=sorted[Math.floor(sorted.length*.9)];
  const span=Math.max(20,high-low), normalized=pitches.map(v=>Math.max(.05,Math.min(.95,(v-low)/span)));
  const smoothed=normalized.map((v,i,a)=>a.slice(Math.max(0,i-2),i+3).reduce((s,n)=>s+n,0)/a.slice(Math.max(0,i-2),i+3).length);
  drawPitch(toneModels[$('practiceTone').value].curve,smoothed);
}

async function toggleRecording() {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    $('recordingStatus').textContent='Recording is not supported here. Try Chrome or Safari.'; return;
  }
  try {
    const stream=await getNaturalVoiceStream();
    recordedChunks=[]; recorder=createVoiceRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data.size) recordedChunks.push(e.data);};
    recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(recordedChunks,{type:recorder.mimeType||'audio/webm'});
      if(recordedUrl) URL.revokeObjectURL(recordedUrl); recordedUrl=URL.createObjectURL(blob);
      $('recordedAudio').src=recordedUrl; $('playRecording').disabled=false;
      $('recordTone').classList.remove('recording'); $('recordTone').textContent='● Start recording';
      $('recordingStatus').textContent='Recording ready. Compare the two lines.';
      try { await analyseRecording(blob); } catch(e) { $('recordingStatus').textContent=e.message+' Try again in a quiet place.'; }
    };
    recorder.start(); $('recordTone').classList.add('recording'); $('recordTone').textContent='■ Stop recording';
    $('recordingStatus').textContent='Recording… Automatic volume control is off. Say the syllable for about one second.';
    setTimeout(()=>{if(recorder&&recorder.state==='recording')recorder.stop();},3500);
  } catch (_) { $('recordingStatus').textContent='Microphone permission was not allowed. Please allow it and try again.'; }
}

function renderHomophones(key='shi4') {
  const mount=$('homophoneGrid'); mount.innerHTML='';
  homophoneFamilies[key].forEach(item=>{
    const card=document.createElement('article'); card.className='homophone-card';
    const top=document.createElement('div'); top.className='homophone-top';
    const char=document.createElement('span'); char.className='homophone-character'; char.textContent=item.char;
    const play=document.createElement('button'); play.type='button'; play.className='homophone-speak'; play.textContent='▶'; play.setAttribute('aria-label',`Listen to ${item.word}`); play.addEventListener('click',()=>speakLabText(item.word,play));
    top.append(char,play); card.append(top);
    const py=document.createElement('strong'); py.textContent=item.pinyin; card.append(py);
    const meaning=document.createElement('small'); meaning.textContent=item.meaning; card.append(meaning);
    const word=document.createElement('p'); word.className='homophone-word'; word.textContent=`${item.word} · ${item.wordPinyin}`; card.append(word);
    const wordMeaning=document.createElement('small'); wordMeaning.textContent=item.wordMeaning; card.append(wordMeaning); mount.append(card);
  });
}

function updateQuizProgress() {
  const total = contextQuestions.length;
  $('quizProgress').textContent = `Question ${(quizIndex % total) + 1} of ${total} · Score ${quizCorrect}/${quizAnswered}`;
}
function renderQuiz() {
  const q=contextQuestions[quizIndex%contextQuestions.length]; $('quizQuestion').textContent=q.sentence; $('quizPinyin').textContent=q.pinyin;
  $('quizFeedback').textContent=''; updateQuizProgress(); const mount=$('quizOptions'); mount.innerHTML='';
  q.options.forEach(option=>{const b=document.createElement('button');b.type='button';b.textContent=option;b.addEventListener('click',()=>{
    mount.querySelectorAll('button').forEach(x=>x.disabled=true); const right = option===q.answer;
    b.classList.add(right?'correct':'wrong');
    if(!right)[...mount.children].find(x=>x.textContent===q.answer)?.classList.add('correct');
    quizAnswered += 1; if (right) quizCorrect += 1; updateQuizProgress();
    $('quizFeedback').textContent=right?`Correct. ${q.explain}`:`Try to read the complete word. ${q.explain}`;
    speakLabText(q.sentence.replace('＿＿',q.answer),document.createElement('button'));
  });mount.append(b);});
}

function initPronunciationLab() {
  if (!$('pronunciationLab')) return;
  $('toneTab').addEventListener('click',()=>showLabPanel('tone'));
  $('homophoneTab').addEventListener('click',()=>showLabPanel('homophone'));
  document.querySelectorAll('.tone-card').forEach(card=>card.querySelectorAll('.tone-audio').forEach(button=>button.addEventListener('click',()=>playStandardTone(button.dataset.audio,button,card.dataset.text))));
  $('practiceTone').addEventListener('change',()=>drawPitch(toneModels[$('practiceTone').value].curve));
  $('hearPracticeTone').addEventListener('click',e=>{const tone=$('practiceTone').value;playStandardTone(`audio/tones/ma-tone-${tone}-once.mp3`,e.currentTarget,toneModels[tone].text);});
  $('recordTone').addEventListener('click',toggleRecording);
  $('playRecording').addEventListener('click',()=>$('recordedAudio').play());
  document.querySelectorAll('.sound-chip').forEach(chip=>chip.addEventListener('click',()=>{document.querySelectorAll('.sound-chip').forEach(c=>c.classList.remove('active'));chip.classList.add('active');renderHomophones(chip.dataset.sound);}));
  $('nextQuiz').addEventListener('click',()=>{quizIndex++;renderQuiz();});
  drawPitch(toneModels[1].curve); renderHomophones(); renderQuiz();
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

/* Course metadata: parsed from the record's original paste text so it works
   no matter how the backend stores the new LESSON/SECTION/SPEAKER/POS/ZHUYIN labels. */
const courseMetaCache = new Map();
function courseMeta(sentence) {
  if (!sentence) return { lesson: '', section: '', speaker: '', pos: '', zhuyin: '' };
  const key = sentence.recordId || sentence.originalPaste || '';
  if (courseMetaCache.has(key)) return courseMetaCache.get(key);
  const parsed = parsePaste(sentence.originalPaste || '');
  const meta = {
    lesson: String(parsed.lesson || '').trim(),
    section: String(parsed.section || '').trim(),
    speaker: String(parsed.speaker || '').trim(),
    pos: String(parsed.pos || '').trim(),
    zhuyin: String(parsed.zhuyin || '').trim()
  };
  courseMetaCache.set(key, meta);
  return meta;
}

function renderSentences() {
  const visible = state.sentences.filter(s => {
    if (courseMeta(s).lesson) return false; /* course records live in the course view */
    const haystack = normalizeSearchText([s.recordId,s.hindiSentence,romanHindiFor(s),s.chineseSentence,s.pinyin,s.hindiExplanation,s.category,s.tags].join(' '));
    const topicMatch = state.selectedCategories.size === 0 || [...sentenceTopics(s)].some(topic => state.selectedCategories.has(topic));
    return matchesKeywordExpression(haystack) && topicMatch;
  });
  const grid = $('sentenceGrid'); grid.innerHTML = '';
  visible.forEach(s => grid.appendChild(createCard(s)));
  $('resultCount').textContent = `${visible.length} shown`;
  $('emptyState').classList.toggle('hidden', visible.length > 0);
}

/* Pinyin quality check: every syllable must be a real Hanyu Pinyin syllable
   and the tone mark must sit on the correct vowel (a > o > e > iu/ui). */
const PINYIN_BASE = new Set(('a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo').split(' '));
const TONE_VOWELS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ';
const TONE_TO_BASE = { 'ā':'a','á':'a','ǎ':'a','à':'a','ē':'e','é':'e','ě':'e','è':'e','ī':'i','í':'i','ǐ':'i','ì':'i','ō':'o','ó':'o','ǒ':'o','ò':'o','ū':'u','ú':'u','ǔ':'u','ù':'u','ǖ':'v','ǘ':'v','ǚ':'v','ǜ':'v' };
function stripToneMarks(syllable) {
  return syllable.toLowerCase().replace(/ü/g, 'v').replace(new RegExp('[' + TONE_VOWELS + ']', 'g'), ch => TONE_TO_BASE[ch] || ch);
}
function toneMarkPositionOk(syllable) {
  const lower = syllable.toLowerCase();
  let marked = -1;
  for (let i = 0; i < lower.length; i += 1) {
    if (TONE_VOWELS.includes(lower[i])) { marked = i; break; }
  }
  if (marked === -1) return true; /* no tone mark, e.g. neutral tone */
  const base = stripToneMarks(syllable);
  const markedVowel = stripToneMarks(syllable[marked]);
  let expected;
  if (base.includes('a')) expected = 'a';
  else if (base.includes('o')) expected = 'o';
  else if (base.includes('e')) expected = 'e';
  else if (base.includes('iu')) expected = 'u';
  else if (base.includes('ui')) expected = 'i';
  else expected = markedVowel; /* single-vowel syllable such as shì or lǜ */
  return markedVowel === expected;
}
/* Split a tone-stripped pinyin word (e.g. "zhongwen") into real syllables. */
function segmentPinyin(base) {
  const memo = {};
  function rec(i) {
    if (i >= base.length) return [];
    if (Object.prototype.hasOwnProperty.call(memo, i)) return memo[i];
    for (let len = Math.min(6, base.length - i); len >= 1; len -= 1) {
      const syl = base.slice(i, i + len);
      const core = (syl.length > 2 && syl.endsWith('r') && !PINYIN_BASE.has(syl)) ? syl.slice(0, -1) : syl; /* erhua */
      if (PINYIN_BASE.has(core)) {
        const rest = rec(i + len);
        if (rest) return (memo[i] = [syl].concat(rest));
      }
    }
    return (memo[i] = null);
  }
  return rec(0);
}
function validatePinyin(pinyinText) {
  const issues = [];
  const tokens = String(pinyinText || '')
    .split(/[\s'’]+/)
    .map(t => t.replace(new RegExp('[^A-Za-z' + TONE_VOWELS + 'üÜ]', 'g'), ''))
    .filter(Boolean);
  tokens.forEach(token => {
    const base = stripToneMarks(token).toLowerCase();
    const syllables = segmentPinyin(base);
    if (!syllables) { issues.push(`“${token}” is not valid pinyin`); return; }
    let pos = 0;
    syllables.forEach(syl => {
      const original = token.slice(pos, pos + syl.length);
      pos += syl.length;
      if (!toneMarkPositionOk(original)) issues.push(`“${original}” has the tone mark on the wrong vowel`);
    });
  });
  return issues;
}

function handlePreview() {
  const pastedText = $('pasteInput').value.trim();
  const text = decodeMobileClipboardText(pastedText);
  if (!text) { $('parseMessage').textContent = 'Paste an AI answer first.'; return; }
  if (text !== pastedText) $('pasteInput').value = text;
  const parsed = parsePaste(text);
  const missing = [['Hindi',parsed.hindiSentence],['Chinese',parsed.chineseSentence],['Pinyin',parsed.pinyin],['Roman',parsed.romanHindi],['Explanation',parsed.hindiExplanation]].filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) { $('parseMessage').textContent = `Please add these labelled parts: ${missing.join(', ')}.`; return; }
  /* Duplicate check against the loaded bank. */
  const chinese = parsed.chineseSentence.trim();
  const hindi = parsed.hindiSentence.trim();
  const exactDupe = state.sentences.find(s => (s.chineseSentence || '').trim() === chinese);
  if (exactDupe) {
    $('parseMessage').textContent = `This Chinese sentence is already in your bank${exactDupe.recordId ? ` (${exactDupe.recordId})` : ''}. Saving it again would create a duplicate.`;
    return;
  }
  const hindiDupe = state.sentences.find(s => (s.hindiSentence || '').trim() === hindi && (s.chineseSentence || '').trim() !== chinese);
  /* Pinyin quality check. */
  const pinyinIssues = validatePinyin(parsed.pinyin);
  const warnings = [];
  if (hindiDupe) warnings.push(`The same Hindi sentence already exists with a different Chinese translation${hindiDupe.recordId ? ` (${hindiDupe.recordId})` : ''}. Check which version is correct before saving.`);
  pinyinIssues.slice(0, 8).forEach(issue => warnings.push(`Pinyin: ${issue}.`));
  if (pinyinIssues.length > 8) warnings.push(`…and ${pinyinIssues.length - 8} more pinyin issues.`);
  if (!/^[A-ZĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/.test(parsed.pinyin.trim())) warnings.push('Pinyin: the first syllable usually starts with a capital letter.');
  state.preview = parsed; state.previewWarnings = warnings; $('parseMessage').textContent = '';
  const mount = $('previewCard'); mount.innerHTML = '';
  if (warnings.length) {
    const box = document.createElement('div');
    box.className = 'preview-warnings';
    box.setAttribute('role', 'status');
    box.innerHTML = '<strong>Please check before saving:</strong>';
    const list = document.createElement('ul');
    warnings.forEach(w => { const li = document.createElement('li'); li.textContent = w; list.appendChild(li); });
    box.appendChild(list);
    mount.appendChild(box);
  }
  mount.appendChild(createCard(parsed, true));
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
  $('apiStatus').className = 'live-status ready'; $('apiStatus').innerHTML = '<i></i> Firebase connected';
  renderFilters(); renderSentences(); renderCourse();
  saveBankCache();
}

function showApiError(message, canRetry) {
  $('apiStatus').className = 'live-status error'; $('apiStatus').innerHTML = '<i></i> Connection problem';
  const grid = $('sentenceGrid');
  grid.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'loading-card';
  card.textContent = message + ' ';
  if (canRetry) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Try again';
    button.addEventListener('click', () => {
      grid.innerHTML = '<div class="loading-card">Loading your sentences…</div>';
      loadBank();
    });
    card.appendChild(button);
  } else {
    card.appendChild(document.createTextNode('Refresh the page to try again.'));
  }
  grid.appendChild(card);
}

/* Last successful bank data, kept on this device as an offline fallback. */
const BANK_CACHE_KEY = 'csbCachedBank';
function saveBankCache() {
  try {
    localStorage.setItem(BANK_CACHE_KEY, JSON.stringify({
      settings: state.settings, sentences: state.sentences,
      categories: state.categories, savedAt: Date.now()
    }));
  } catch (_) {}
}
function loadBankCache() {
  try {
    const data = JSON.parse(localStorage.getItem(BANK_CACHE_KEY));
    if (!data || !Array.isArray(data.sentences)) return null;
    return data;
  } catch (_) { return null; }
}
function describeCacheAge(savedAt) {
  const minutes = Math.max(0, Math.round((Date.now() - (savedAt || Date.now())) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  return hours < 24 ? hours + ' h ago' : Math.round(hours / 24) + ' d ago';
}

function openPinDialog() {
  if (!state.preview) return;
  try { $('pinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
  $('saveMessage').textContent = '';
  $('pinDialog').showModal();
  setTimeout(() => $('pinInput').focus(), 50);
}

async function submitSentence() {
  const pin = $('pinInput').value.trim();
  if (!pin) { $('saveMessage').textContent = 'Enter the submission PIN.'; return; }
  if (!state.preview) { $('pinDialog').close(); return; }
  if ($('rememberPin').checked) { try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {} }
  else { try { localStorage.removeItem('csbSubmissionPin'); } catch (_) {} }

  $('confirmSave').disabled = true;
  $('saveMessage').textContent = 'Saving sentence…';
  const submitted = { ...state.preview };

  try {
    await ensureAuth();
    await fbDb.collection(SENTENCES_COL).add(sentenceDocData(submitted));
    await reloadSentences();
    renderSentences();
    $('saveMessage').textContent = 'Saved successfully!'; $('confirmSave').disabled = false;
    $('pasteInput').value = ''; $('previewPanel').classList.add('hidden');
    setTimeout(() => { $('pinDialog').close(); $('libraryTitle').scrollIntoView({behavior:'smooth'}); }, 800);
  } catch (err) {
    $('confirmSave').disabled = false;
    $('saveMessage').textContent = `Save failed: ${(err && err.message) || 'Unknown error.'}`;
  }
}

async function loadBank(attempt = 1) {
  const MAX_ATTEMPTS = 3;
  window.__sentenceBankLoaded = false;
  $('apiStatus').className = 'live-status';
  $('apiStatus').innerHTML = attempt > 1 ? `<i></i> Retrying… (${attempt}/${MAX_ATTEMPTS})` : '<i></i> Connecting';
  if (firebaseInitError) {
    handleBankFailure(attempt, MAX_ATTEMPTS, `Firebase could not start: ${firebaseInitError}`);
    return;
  }
  try {
    const [snap, settingsSnap] = await Promise.all([
      fbDb.collection(SENTENCES_COL).get(),
      fbDb.collection(META_COL).doc(SETTINGS_DOC).get(),
    ]);
    const sentences = sortSentencesBySeq(snap.docs.map(d => docToSentence(d.id, d.data())));
    const settings = settingsSnap.exists ? { ...defaultSettings(), ...settingsSnap.data() } : defaultSettings();
    /* Start anonymous auth in the background so writes are ready when needed. */
    ensureAuth().catch(err => console.warn('Anonymous sign-in failed:', err && err.message));
    receiveBank({ success: true, settings, sentences });
  } catch (err) {
    handleBankFailure(attempt, MAX_ATTEMPTS, `Could not reach Firebase: ${(err && err.message) || 'unknown error'}.`);
  }
}

function handleBankFailure(attempt, maxAttempts, message) {
  if (attempt < maxAttempts) {
    setTimeout(() => loadBank(attempt + 1), attempt * 2000);
    return;
  }
  const cached = loadBankCache();
  if (cached) {
    receiveBank({ success: true, settings: cached.settings, sentences: cached.sentences });
    $('apiStatus').className = 'live-status error';
    $('apiStatus').innerHTML = `<i></i> Showing saved copy (${describeCacheAge(cached.savedAt)})`;
    const notice = document.createElement('div');
    notice.className = 'cache-notice';
    notice.innerHTML = 'You are offline. Showing the last saved copy of your sentence bank. ';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-button'; button.textContent = 'Try again';
    button.addEventListener('click', () => {
      $('sentenceGrid').innerHTML = '<div class="loading-card">Loading your sentences…</div>';
      loadBank();
    });
    notice.appendChild(button);
    $('sentenceGrid').prepend(notice);
    return;
  }
  showApiError(message + ' ', true);
}

$('startButton').addEventListener('click', () => $('createPrompt').scrollIntoView({behavior:'smooth'}));
$('refreshButton').addEventListener('click', () => {
  $('refreshButton').disabled = true;
  $('refreshButton').textContent = '…';
  window.location.reload();
});
$('generatePrompt').addEventListener('click', buildPrompt);
$('clearPrompt').addEventListener('click', () => {
  $('promptSentence').value = '';
  $('generatedPrompt').value = '';
  $('generatedPromptPanel').classList.add('hidden');
  $('promptMessage').textContent = '';
  $('promptCopyStatus').textContent = '';
  $('promptSentence').focus();
});
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
$('confirmAudioSave').addEventListener('click', submitTeacherAudio);
$('audioPinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitTeacherAudio(); });
$('closeAudioPin').addEventListener('click', () => { pendingModelSave = null; $('audioPinDialog').close(); });
$('confirmDelete').addEventListener('click', submitDeleteSentence);
$('deletePinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitDeleteSentence(); });
$('closeDelete').addEventListener('click', () => { pendingDeleteSentence = null; $('deleteDialog').close(); });
$('confirmEdit').addEventListener('click', submitEdit);
$('editPinInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitEdit(); });
$('closeEdit').addEventListener('click', () => { pendingEditSentence = null; pendingSuppLesson = null; $('confirmEdit').textContent = 'Save changes'; $('editDialog').close(); });
['editHindi', 'editChinese', 'editPinyin', 'editRoman', 'editExplanation'].forEach(id => $(id).addEventListener('input', updateEditWarnings));
initPronunciationLab();
loadBank();

/* ================= Course module: 當代中文課程 ================= */
/* 課號規則：1–15 ＝第二冊，101–115 ＝第一冊（第一冊第 X 課記為 100+X），201–212 ＝第三冊（第三冊第 X 課記為 200+X），301–312 ＝第四冊（第四冊第 X 課記為 300+X），501–510 ＝第五冊（第五冊第 X 課記為 500+X）。 */
function bookOf(n) { n = Number(n); return n >= 601 ? 6 : (n >= 501 ? 5 : (n >= 301 ? 4 : (n >= 201 ? 3 : (n >= 101 ? 1 : 2)))); }
function bookLessonNum(n) { n = Number(n); return n >= 601 ? n - 600 : (n >= 501 ? n - 500 : (n >= 301 ? n - 300 : (n >= 201 ? n - 200 : (n >= 101 ? n - 100 : n)))); }
function lessonLabel(n) {
  const b = bookOf(n);
  return b === 6 ? `第六冊第 ${bookLessonNum(n)} 課` : (b === 5 ? `第五冊第 ${bookLessonNum(n)} 課` : (b === 4 ? `第四冊第 ${bookLessonNum(n)} 課` : (b === 3 ? `第三冊第 ${bookLessonNum(n)} 課` : (b === 1 ? `第一冊第 ${bookLessonNum(n)} 課` : `第二冊第 ${n} 課`)));
}
function lessonShortLabel(n) {
  const b = bookOf(n);
  return b === 6 ? `第六冊第${bookLessonNum(n)}課` : (b === 5 ? `第五冊第${bookLessonNum(n)}課` : (b === 4 ? `第四冊第${bookLessonNum(n)}課` : (b === 3 ? `第三冊第${bookLessonNum(n)}課` : (b === 1 ? `第一冊第${bookLessonNum(n)}課` : `第二冊第${n}課`)));
}
function bookTitle(n) {
  const b = bookOf(n);
  return b === 6 ? '第六冊・當代中文課程' : (b === 5 ? '第五冊・當代中文課程' : (b === 4 ? '第四冊・當代中文課程' : (b === 3 ? '第三冊・當代中文課程' : (b === 1 ? '第一冊・當代中文課程' : '第二冊・當代中文課程')));
}
const COURSE_LESSONS = [
  { n: 101, zh: '歡迎你來臺灣！', en: 'Welcome to Taiwan!', topic: '自我介紹' },
  { n: 102, zh: '我的家人', en: 'My Family', topic: '家人' },
  { n: 103, zh: '週末做什麼？', en: 'What Are You Doing Over the Weekend?', topic: '休閒' },
  { n: 104, zh: '請問一共多少錢？', en: 'Excuse Me. How Much Does That Cost in Total?', topic: '購物' },
  { n: 105, zh: '牛肉麵真好吃', en: 'Beef Noodles Are Really Delicious', topic: '飲食' },
  { n: 106, zh: '他們學校在山上', en: 'Their School Is Up in the Mountains', topic: '方位' },
  { n: 107, zh: '早上九點去KTV', en: "Going to KTV at 9 O'clock in the Morning", topic: '時間' },
  { n: 108, zh: '坐火車去臺南', en: 'Taking a Train to Tainan', topic: '交通' },
  { n: 109, zh: '放假去哪裡玩？', en: 'Where Will You Go for the Holidays?', topic: '假期' },
  { n: 110, zh: '臺灣的水果很好吃', en: 'The Fruit in Taiwan Tastes Really Good', topic: '外貌' },
  { n: 111, zh: '我要租房子', en: 'I Would Like to Rent a Place', topic: '租屋' },
  { n: 112, zh: '你在臺灣學多久的中文？', en: 'How Long Have You Been Studying Chinese in Taiwan?', topic: '學習' },
  { n: 113, zh: '生日快樂', en: 'Happy Birthday', topic: '社交' },
  { n: 114, zh: '天氣這麼冷！', en: "It's So Cold!", topic: '天氣' },
  { n: 115, zh: '我很不舒服', en: "I Don't Feel Well", topic: '生病' },
  { n: 1, zh: '請問，到師大怎麼走？', en: 'Excuse Me. How Do You Get to Shida?', topic: '問路' },
  { n: 2, zh: '還是坐捷運吧！', en: 'Take the MRT Instead!', topic: '交通' },
  { n: 3, zh: '你的中文進步了！', en: 'Your Chinese Has Improved!', topic: '學習' },
  { n: 4, zh: '我打工，我教法文', en: 'I Work Part-Time Teaching French', topic: '打工' },
  { n: 5, zh: '吃喜酒', en: 'Attending a Wedding Banquet', topic: '婚禮' },
  { n: 6, zh: '我打算搬到學校附近', en: 'I Plan to Move Near the School', topic: '搬家' },
  { n: 7, zh: '垃圾車來了！', en: 'The Garbage Truck Is Here!', topic: '環保' },
  { n: 8, zh: '學功夫', en: 'Learning Kung Fu', topic: '運動' },
  { n: 9, zh: '那個城市好漂亮', en: 'That City Is So Beautiful', topic: '旅遊' },
  { n: 10, zh: '歡迎到我家來包餃子', en: 'Welcome to My Home for Dumplings', topic: '飲食' },
  { n: 11, zh: '台灣好玩的地方真多', en: 'Taiwan Has So Many Fun Places', topic: '觀光' },
  { n: 12, zh: '怎麼吃才健康？', en: 'How to Eat Healthily?', topic: '健康' },
  { n: 13, zh: '我的手機掉了', en: 'I Lost My Cell Phone', topic: '意外' },
  { n: 14, zh: '我要開始找工作了', en: "I'm Going to Start Job Hunting", topic: '求職' },
  { n: 15, zh: '過春節', en: 'Celebrating Spring Festival', topic: '節慶' },
  { n: 201, zh: '開學了', en: 'School Is Starting', topic: '開學' },
  { n: 202, zh: '八折起', en: 'Starting at 20% Off', topic: '購物' },
  { n: 203, zh: '外套帶了沒有？', en: 'Did You Bring Your Coat?', topic: '生活' },
  { n: 204, zh: '我愛台灣的人情味', en: 'I Love the Human Touch of Taiwan', topic: '人情' },
  { n: 205, zh: '現在流行什麼？', en: "What's in Fashion Now?", topic: '流行' },
  { n: 206, zh: '到鄉下住一晚！', en: 'A Night in the Countryside!', topic: '鄉村' },
  { n: 207, zh: '我最親的家「人」', en: 'My Closest "Family"', topic: '家庭' },
  { n: 208, zh: '我想做自己', en: 'I Want to Be Myself', topic: '自我' },
  { n: 209, zh: '網購時代', en: 'The Age of Online Shopping', topic: '網購' },
  { n: 210, zh: '我住院了', en: 'I Am in the Hospital', topic: '醫療' },
  { n: 211, zh: '台灣故事', en: 'Stories of Taiwan', topic: '歷史' },
  { n: 212, zh: '我要去投票', en: "I'm Going to Vote", topic: '選舉' },
  { n: 301, zh: '十七歲還是二十五歲？', en: '17 or 25-Years Old?', topic: '網路' },
  { n: 302, zh: '眼睛、耳朵的饗宴', en: 'A Feast for the Eyes and Ears', topic: '藝術' },
  { n: 303, zh: '雲端科技', en: 'Cloud Technology', topic: '科技' },
  { n: 304, zh: '床該擺哪裡？', en: 'Where Should the Bed Go?', topic: '風水' },
  { n: 305, zh: '有夢最美', en: 'Pursuing Your Dreams', topic: '夢想' },
  { n: 306, zh: '天搖地動', en: 'Shaking Heavens and Trembling Earth', topic: '地震' },
  { n: 307, zh: '大學生的事', en: 'College Student Matters', topic: '大學' },
  { n: 308, zh: '他們的選擇', en: 'Their Choice', topic: '家庭' },
  { n: 309, zh: '再談台灣故事', en: 'More on the Story of Taiwan', topic: '歷史' },
  { n: 310, zh: '應徵', en: 'Applying for a Job', topic: '求職' },
  { n: 311, zh: '文化、種族的大熔爐', en: 'The Big Cultural and Ethnic Melting Pot', topic: '文化' },
  { n: 312, zh: '期待美好的未來', en: 'Looking Forward to a Beautiful Future', topic: '未來' },
  { n: 501, zh: '言論自由的界線', en: 'The Boundaries of Free Speech', topic: '言論' },
  { n: 502, zh: '關於基改食品，我有話要說', en: 'Speaking Up About GM Food', topic: '食安' },
  { n: 503, zh: '整型好不好', en: 'Is Plastic Surgery a Good Idea?', topic: '整型' },
  { n: 504, zh: '傳統與現代', en: 'Tradition and Modernity', topic: '文化' },
  { n: 505, zh: '代理孕母，帶來幸福？', en: 'Surrogate Motherhood: Happiness?', topic: '倫理' },
  { n: 506, zh: '死刑的存廢', en: 'The Death Penalty Debate', topic: '死刑' },
  { n: 507, zh: '增富人稅＝減窮人苦？', en: 'Taxing the Rich to Help the Poor?', topic: '稅制' },
  { n: 508, zh: '左右為難的難民問題', en: 'The Refugee Dilemma', topic: '難民' },
  { n: 509, zh: '有核到底可不可？', en: 'Nuclear Power: Yes or No?', topic: '核能' },
  { n: 510, zh: '同性婚姻合法化', en: 'Legalizing Same-Sex Marriage', topic: '婚姻' },
  { n: 601, zh: '職校教育', en: 'Vocational Education', topic: '教育' },
  { n: 602, zh: '科技與生活', en: 'Technology and Life', topic: '科技' },
  { n: 603, zh: '舞蹈藝術', en: 'The Art of Dance', topic: '藝術' },
  { n: 604, zh: '做人與心法', en: 'Being Human and Mindset', topic: '人生' },
  { n: 605, zh: '國際語言', en: 'International Language', topic: '語言' },
  { n: 606, zh: '貓熊角色', en: 'The Panda Role', topic: '貓熊' },
  { n: 607, zh: '感情世界', en: 'The Emotional World', topic: '感情' },
  { n: 608, zh: '奧運黑洞', en: 'The Olympic Black Hole', topic: '奧運' },
  { n: 609, zh: '鄉關何處', en: 'Where Is Home?', topic: '鄉愁' },
  { n: 610, zh: '智慧與能力', en: 'Wisdom and Ability', topic: '智慧' }
];
const COURSE_TABS = ['課文', '生詞', '語法', '練習', '文化', '補充'];
const COURSE_PACK_LESSONS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610];
const courseState = { lesson: 0, tab: '課文' };

function isCourseUnlocked() {
  try { return sessionStorage.getItem('csbCourseUnlocked') === '1'; } catch (_) { return false; }
}

function lessonRecords(n) {
  const key = String(n);
  return state.sentences.filter(s => courseMeta(s).lesson === key);
}

function renderCourse() {
  const lock = $('courseLock'), body = $('courseBody');
  if (!lock || !body) return;
  if (!isCourseUnlocked()) {
    lock.classList.remove('hidden'); body.classList.add('hidden');
    return;
  }
  lock.classList.add('hidden'); body.classList.remove('hidden');
  if (courseState.lesson > 0) renderLessonView();
  else renderLessonGrid();
}

function unlockCourse() {
  const pin = $('coursePinInput').value.trim();
  const msg = $('courseLockMessage');
  if (!pin) { msg.textContent = '請輸入老師 PIN。'; return; }
  /* 以這次輸入的 PIN 為準並記住，不再比對殘留的舊值（舊邏輯會因 localStorage 殘留舊 PIN 而永久鎖死）。 */
  try {
    localStorage.setItem('csbSubmissionPin', pin);
    sessionStorage.setItem('csbCourseUnlocked', '1');
  } catch (_) {}
  msg.textContent = '';
  renderCourse();
}

function renderLessonGrid() {
  $('lessonView').classList.add('hidden');
  const grid = $('lessonGrid');
  grid.classList.remove('hidden');
  grid.innerHTML = '';
  let lastBook = 0;
  COURSE_LESSONS.forEach(lesson => {
    const bk = bookOf(lesson.n);
    if (bk !== lastBook) {
      lastBook = bk;
      const divider = document.createElement('div');
      divider.className = 'book-divider';
      divider.textContent = bookTitle(lesson.n);
      grid.appendChild(divider);
    }
    const recs = lessonRecords(lesson.n);
    const hasPack = COURSE_PACK_LESSONS.includes(lesson.n);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'lesson-card' + (recs.length ? '' : ' lesson-card-empty');
    card.innerHTML = `
      <span class="lesson-num">${lessonLabel(lesson.n)}</span>
      <span class="lesson-zh" lang="zh-Hant">${lesson.zh}</span>
      <span class="lesson-en">${lesson.en}</span>
      <span class="lesson-topic">${lesson.topic}</span>
      <span class="lesson-status">${recs.length ? `已匯入 ${recs.length} 條` : (hasPack ? '尚未匯入' : '準備中')}</span>`;
    card.setAttribute('aria-label', `${lessonLabel(lesson.n)} ${lesson.zh}`);
    if (recs.length) {
      card.addEventListener('click', () => { courseState.lesson = lesson.n; courseState.tab = '課文'; renderLessonView(); });
    } else {
      card.disabled = true;
      card.title = hasPack ? '請先在課程管理匯入內容包' : '內容準備中';
    }
    grid.appendChild(card);
  });
}

function openLesson(n) {
  courseState.lesson = n; courseState.tab = '課文';
  renderLessonView();
  $('courseSection').scrollIntoView({ behavior: 'smooth' });
}

function renderLessonView() {
  const n = courseState.lesson;
  const lesson = COURSE_LESSONS.find(l => l.n === n);
  if (!lesson) { renderLessonGrid(); return; }
  $('lessonGrid').classList.add('hidden');
  const view = $('lessonView');
  view.classList.remove('hidden');
  const recs = lessonRecords(n);
  const bySection = {};
  recs.forEach(s => {
    const sec = courseMeta(s).section || '課文';
    (bySection[sec] = bySection[sec] || []).push(s);
  });

  const header = $('lessonHeader');
  const goals = bySection['目標'] || [];
  header.innerHTML = `
    <div class="lesson-header-top"><span class="lesson-num">${lessonLabel(lesson.n)}</span><span class="lesson-topic">${lesson.topic}</span></div>
    <h3 class="lesson-header-zh" lang="zh-Hant">${lesson.zh}</h3>
    <p class="lesson-header-en">${lesson.en}</p>
    ${goals.map(s => `<div class="lesson-goals"><strong>學習目標</strong><p lang="hi">${escapeHtml(s.hindiExplanation || s.hindiSentence || '')}</p></div>`).join('')}`;

  const tabs = $('lessonTabs');
  tabs.innerHTML = '';
  COURSE_TABS.forEach(tab => {
    const count = (bySection[tab] || []).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-tab' + (courseState.tab === tab ? ' active' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', courseState.tab === tab ? 'true' : 'false');
    button.textContent = `${tab}${count ? ` ${count}` : ''}`;
    button.addEventListener('click', () => { courseState.tab = tab; renderLessonView(); });
    tabs.appendChild(button);
  });

  const content = $('lessonContent');
  content.innerHTML = '';
  const tabRecs = bySection[courseState.tab] || [];
  /* 補充分頁永遠顯示：即使還沒有內容，老師也要能按「新增」。 */
  if (courseState.tab === '補充') { renderSuppTab(content, tabRecs, n); return; }
  if (!tabRecs.length) {
    content.innerHTML = '<div class="loading-card">這個單元還沒有內容。</div>';
    return;
  }
  if (courseState.tab === '課文') renderTextTab(content, tabRecs);
  else if (courseState.tab === '生詞') renderVocabTab(content, tabRecs);
  else if (courseState.tab === '語法') renderGrammarTab(content, tabRecs, n);
  else renderInfoTab(content, tabRecs, courseState.tab);
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function tagList(s) {
  return String(s.tags || '').split(/[,;|]/).map(t => t.trim()).filter(Boolean);
}

/* ---- 課文：對話／短文 ---- */
function textGroupName(s) {
  const tags = tagList(s);
  for (const name of ['對話一', '對話二', '對話三', '對話', '短文']) {
    if (tags.includes(name)) return name;
  }
  return '課文';
}

function renderTextTab(content, recs) {
  const groups = {};
  recs.forEach(s => {
    const g = textGroupName(s);
    (groups[g] = groups[g] || []).push(s);
  });
  Object.keys(groups).sort((a, b) => {
    const order = ['對話一', '對話二', '對話三', '對話', '短文', '課文'];
    return order.indexOf(a) - order.indexOf(b);
  }).forEach(groupName => {
    const lines = groups[groupName];
    const section = document.createElement('div');
    section.className = 'text-group';
    const head = document.createElement('div');
    head.className = 'text-group-head';
    const title = document.createElement('h4');
    title.textContent = groupName;
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'secondary-button text-play-button';
    playButton.textContent = '▶ 連播';
    playButton.setAttribute('aria-label', `連播${groupName}`);
    playButton.addEventListener('click', () => playTextGroup(lines, playButton));
    head.appendChild(title); head.appendChild(playButton);
    section.appendChild(head);
    lines.forEach(s => {
      const card = createCard(s);
      const speaker = courseMeta(s).speaker;
      if (speaker) {
        const badge = document.createElement('div');
        badge.className = 'script-speaker';
        badge.textContent = speaker;
        badge.setAttribute('lang', 'zh-Hant');
        card.insertBefore(badge, card.firstChild);
      }
      section.appendChild(card);
    });
    content.appendChild(section);
  });
}

/* ---- 生詞：緊湊單字卡 ---- */
function vocabGroupName(s) {
  const tags = tagList(s);
  if (tags.includes('生詞一')) return '生詞一';
  if (tags.includes('生詞二')) return '生詞二';
  return '生詞';
}

function renderVocabTab(content, recs) {
  const groups = {};
  recs.forEach(s => {
    const g = vocabGroupName(s);
    (groups[g] = groups[g] || []).push(s);
  });
  ['生詞一', '生詞二', '生詞'].filter(g => groups[g]).forEach(groupName => {
    const head = document.createElement('h4');
    head.className = 'text-group-head-title';
    head.textContent = `${groupName}（${groups[groupName].length}）`;
    content.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'vocab-grid';
    groups[groupName].forEach(s => grid.appendChild(createVocabCard(s)));
    content.appendChild(grid);
  });
}

function createVocabCard(sentence) {
  const meta = courseMeta(sentence);
  const node = document.createElement('div');
  node.className = 'vocab-card';
  node.innerHTML = `
    <div class="vocab-top"><span class="vocab-word" lang="zh-Hant"></span>${meta.pos ? `<span class="vocab-pos">${escapeHtml(meta.pos)}</span>` : ''}</div>
    <div class="vocab-pinyin"></div>
    ${meta.zhuyin ? `<div class="vocab-zhuyin" lang="zh-Hant"></div>` : ''}
    <div class="vocab-hindi-row"><span class="vocab-hindi" lang="hi"></span><button type="button" class="icon-button vocab-hindi-speak" aria-label="Play Hindi">🔊</button></div>
    <div class="vocab-roman"></div>
    <div class="vocab-example"></div>
    <div class="vocab-actions">
      <button type="button" class="icon-button vocab-speak" aria-label="Play Chinese" title="Play Chinese">🔊</button>
      <button type="button" class="icon-button card-record-button" aria-label="Record your voice" title="Record">🎙</button>
      <button type="button" class="icon-button card-play-button" aria-label="Play your recording" title="Play recording">▶</button>
      <button type="button" class="icon-button card-save-model-button" aria-label="Save as teacher model" title="Save as teacher model">💾</button>
      <button type="button" class="icon-button vocab-edit" aria-label="Edit" title="Edit">✏️</button>
    </div>
    <div class="card-recording-status vocab-status" aria-live="polite"></div>`;
  node.querySelector('.vocab-word').textContent = sentence.chineseSentence || '';
  node.querySelector('.vocab-pinyin').textContent = sentence.pinyin || '';
  const zhuyinEl = node.querySelector('.vocab-zhuyin');
  if (zhuyinEl) zhuyinEl.textContent = meta.zhuyin;
  node.querySelector('.vocab-hindi').textContent = sentence.hindiSentence || '';
  const roman = romanHindiFor(sentence);
  const romanEl = node.querySelector('.vocab-roman');
  romanEl.textContent = roman || '';
  romanEl.hidden = !roman;
  romanEl.setAttribute('lang', 'hi-Latn');
  const exampleEl = node.querySelector('.vocab-example');
  exampleEl.textContent = sentence.hindiExplanation || '';
  exampleEl.hidden = !sentence.hindiExplanation;
  node.querySelector('.vocab-hindi-speak').addEventListener('click', e => speakHindi(sentence.hindiSentence, e.currentTarget));
  node.querySelector('.vocab-speak').addEventListener('click', e => playSentenceModel(sentence, e.currentTarget));
  node.querySelector('.card-record-button').addEventListener('click', () => toggleCardRecording(node, sentence, false));
  node.querySelector('.card-play-button').addEventListener('click', () => {
    const recording = recordingForSentence(sentence);
    if (recording) new Audio(recording.url).play();
  });
  node.querySelector('.card-save-model-button').addEventListener('click', () => openAudioPinDialog(sentence, node));
  node.querySelector('.vocab-edit').addEventListener('click', () => openEditDialog(sentence));
  return node;
}

/* ---- 語法：句型＋例句 ---- */
function renderGrammarTab(content, recs, lessonNum) {
  const groups = {};
  recs.forEach(s => {
    const tags = tagList(s);
    const key = tags.find(t => new RegExp(`^L${lessonNum}-G\\d+$`, 'i').test(t)) || '其他';
    (groups[key] = groups[key] || []).push(s);
  });
  Object.keys(groups).sort().forEach(key => {
    const items = groups[key];
    const point = items.find(s => tagList(s).some(t => t === '句型')) || items[0];
    const examples = items.filter(s => s !== point);
    const block = document.createElement('div');
    block.className = 'grammar-block';
    const head = document.createElement('div');
    head.className = 'grammar-point';
    head.innerHTML = `
      <div class="grammar-pattern" lang="zh-Hant"></div>
      <div class="grammar-pinyin"></div>
      <div class="grammar-hindi" lang="hi"></div>
      <div class="grammar-function" lang="hi"></div>`;
    head.querySelector('.grammar-pattern').textContent = point.chineseSentence || '';
    head.querySelector('.grammar-pinyin').textContent = point.pinyin || '';
    head.querySelector('.grammar-hindi').textContent = point.hindiSentence || '';
    const funcEl = head.querySelector('.grammar-function');
    funcEl.textContent = point.hindiExplanation || '';
    funcEl.hidden = !point.hindiExplanation;
    block.appendChild(head);
    examples.forEach(s => block.appendChild(createCard(s)));
    content.appendChild(block);
  });
}

/* ---- 練習／文化：說明卡 ---- */
function renderInfoTab(content, recs, tabName) {
  recs.forEach(s => {
    const card = document.createElement('div');
    card.className = 'info-card';
    card.innerHTML = `
      <div class="info-kicker">${tabName}</div>
      <h4 class="info-zh" lang="zh-Hant"></h4>
      <p class="info-hi" lang="hi"></p>
      <p class="info-explain" lang="hi"></p>
      <div class="info-actions"><button type="button" class="icon-button info-edit" aria-label="Edit" title="Edit">✏️</button></div>`;
    card.querySelector('.info-zh').textContent = s.chineseSentence || '';
    card.querySelector('.info-hi').textContent = s.hindiSentence || '';
    const explainEl = card.querySelector('.info-explain');
    explainEl.textContent = s.hindiExplanation || '';
    explainEl.hidden = !s.hindiExplanation;
    card.querySelector('.info-edit').addEventListener('click', () => openEditDialog(s));
    content.appendChild(card);
  });
}

/* ---- 補充：老師針對本課臨時加的句子 ---- */
function renderSuppTab(content, recs, lessonNum) {
  const bar = document.createElement('div');
  bar.className = 'supp-bar';
  const hint = document.createElement('p');
  hint.className = 'supp-hint';
  hint.textContent = '老師針對本課補充的句子：課堂上臨時加的例句、學生問到的句子，都可以記在這裡，跟著本課走。';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'primary-button';
  addButton.textContent = '＋ 新增補充句子';
  addButton.addEventListener('click', () => openSuppDialog(lessonNum));
  bar.appendChild(hint);
  bar.appendChild(addButton);
  content.appendChild(bar);
  if (!recs.length) {
    const empty = document.createElement('div');
    empty.className = 'loading-card';
    empty.textContent = '還沒有補充內容，按上面按鈕新增第一句。';
    content.appendChild(empty);
    return;
  }
  recs.forEach(s => {
    const card = createCard(s);
    const speaker = courseMeta(s).speaker;
    if (speaker) {
      const badge = document.createElement('div');
      badge.className = 'script-speaker';
      badge.textContent = speaker;
      badge.setAttribute('lang', 'zh-Hant');
      card.insertBefore(badge, card.firstChild);
    }
    content.appendChild(card);
  });
}

/* ---- 課文連播 ---- */
let textPlay = { playing: false, queue: [], index: 0 };
function stopTextPlay() {
  textPlay.playing = false;
  try { speechSynthesis.cancel(); } catch (_) {}
  document.querySelectorAll('.text-play-button.text-playing').forEach(b => {
    b.classList.remove('text-playing');
    b.textContent = '▶ 連播';
  });
}
async function fetchTeacherAudioUrl(sentence) {
  if (!sentence.standardAudioUrl) return null;
  const cached = teacherAudioCache.get(sentence.recordId);
  if (cached) return cached;
  try {
    const url = await fbStorage.ref(sentence.audioPath || sentence.standardAudioUrl).getDownloadURL();
    teacherAudioCache.set(sentence.recordId, url);
    return url;
  } catch (_) {
    return null;
  }
}
function playTextGroup(lines, button) {
  if (textPlay.playing) { stopTextPlay(); return; }
  stopTextPlay();
  textPlay = { playing: true, queue: lines.slice(), index: 0 };
  button.classList.add('text-playing');
  button.textContent = '⏹ 停止';
  playNextTextLine();
}
async function playNextTextLine() {
  if (!textPlay.playing) return;
  if (textPlay.index >= textPlay.queue.length) { stopTextPlay(); return; }
  const s = textPlay.queue[textPlay.index];
  const audioUrl = await fetchTeacherAudioUrl(s);
  if (!textPlay.playing) return;
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    audio.onended = audio.onerror = () => { textPlay.index += 1; playNextTextLine(); };
    try { await audio.play(); } catch (_) { textPlay.index += 1; playNextTextLine(); }
  } else {
    try {
      const utterance = new SpeechSynthesisUtterance(s.chineseSentence || '');
      utterance.lang = state.settings.defaultVoice || 'zh-TW';
      utterance.rate = Number(state.settings.speechRate) || 0.85;
      utterance.onend = utterance.onerror = () => { textPlay.index += 1; playNextTextLine(); };
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    } catch (_) { textPlay.index += 1; playNextTextLine(); }
  }
}

/* ---- 內容包匯入 ---- */
let packRecordsCache = [];
function splitPackRecords(text) {
  return String(text || '').split(/^===RECORD===$/m).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}
async function loadPackPreview() {
  const fileInput = $('packFileInput');
  const file = fileInput && fileInput.files && fileInput.files[0];
  const info = $('packInfo');
  const importButton = $('packImportButton');
  importButton.disabled = true;
  packRecordsCache = [];
  if (!file) { info.textContent = '請先選擇內容包 .txt 檔案（例如 packs/lesson-01.txt）。'; return; }
  info.textContent = '讀取中…';
  try {
    const text = await file.text();
    const records = splitPackRecords(text);
    if (!records.length) throw new Error('檔案中沒有找到記錄');
    const lessonKey = String(parsePaste(records[0]).lesson || '');
    const updateMode = $('importUpdateCheckbox').checked;
    const lessonNum = Number(lessonKey) || 0;
    /* 比對鍵：課＋節＋中文＋說話人＋解釋；中文鍵作後備，避免重複寫入。 */
    const matchKey = (lesson, section, chinese, speaker, expl) =>
      [lesson, section, chinese, speaker, expl].join('‖');
    const existingByKey = new Map();
    const existingByChinese = new Map();
    lessonRecords(lessonKey).forEach(s => {
      const m = courseMeta(s);
      existingByKey.set(matchKey(m.lesson, m.section, (s.chineseSentence || '').trim(), m.speaker, (s.hindiExplanation || '').trim()), s);
      const ck = (s.chineseSentence || '').trim();
      if (ck && !existingByChinese.has(ck)) existingByChinese.set(ck, s);
    });
    const items = [];
    records.forEach((r, idx) => {
      const p = parsePaste(r);
      if (!p.chineseSentence) return;
      const ck = p.chineseSentence.trim();
      const old = existingByKey.get(matchKey(lessonKey, (p.section || '').trim(), ck, (p.speaker || '').trim(), (p.hindiExplanation || '').trim()))
        || existingByChinese.get(ck);
      if (old && !updateMode) return; /* 已存在且未勾更新：跳過 */
      items.push({
        content: r,
        oldRecordId: old ? old.recordId : null,
        hasAudio: !!(old && (old.standardAudioUrl || teacherAudioCache.get(old.recordId) || recordingForSentence(old))),
        seq: lessonNum ? lessonNum * 100000 + (idx + 1) : null, /* 內容包內順序 */
      });
    });
    packRecordsCache = items;
    const updates = items.filter(i => i.oldRecordId).length;
    const fresh = items.length - updates;
    const lessonLabelText = lessonKey ? lessonLabel(Number(lessonKey)) : '內容包';
    info.textContent = `${lessonLabelText}：${records.length} 條記錄，${fresh} 條新增${updates ? `，${updates} 條更新（取代舊記錄）` : ''}。`;
    try { $('importPinInput').value = localStorage.getItem('csbSubmissionPin') || ''; } catch (_) {}
    importButton.disabled = items.length === 0;
  } catch (err) {
    info.textContent = `讀取失敗：${err.message}。`;
  }
}
/* 內容包批次匯入：整包一次寫入 Firestore。
   更新模式＝原地 update（保留 recordId、錄音、建立時間），不再建新刪舊。 */
async function importPackRecords() {
  const pin = $('importPinInput').value.trim();
  const progress = $('importProgress');
  if (!pin) { progress.textContent = '請輸入老師 PIN。'; return; }
  if (!packRecordsCache.length) { progress.textContent = '沒有可匯入的記錄。'; return; }
  try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {}
  const button = $('packImportButton');
  button.disabled = true;
  const total = packRecordsCache.length;
  let added = 0, updated = 0;
  progress.textContent = `批次寫入中 0/${total}…`;
  try {
    await ensureAuth();
    const BATCH_LIMIT = 450; /* Firestore 每批上限 500 */
    let batch = fbDb.batch();
    let ops = 0;
    const commitIfFull = async () => {
      if (ops >= BATCH_LIMIT) { await batch.commit(); batch = fbDb.batch(); ops = 0; }
    };
    for (const item of packRecordsCache) {
      const parsed = parsePaste(item.content);
      const data = sentenceDocData({
        hindiSentence: parsed.hindiSentence || '',
        chineseSentence: parsed.chineseSentence || '',
        pinyin: parsed.pinyin || '',
        romanHindi: parsed.romanHindi || '',
        hindiExplanation: parsed.hindiExplanation || '',
        category: parsed.category || '課程',
        tags: parsed.tags || '',
        aiSource: parsed.aiSource || '當代中文課程2',
        originalPaste: item.content,
        seq: item.seq,
      });
      if (item.oldRecordId) {
        /* 更新：只換內容欄位，保留 recordId、建立時間與錄音。 */
        const { createdAt, audioPath, audioMime, favorite, ...contentFields } = data;
        batch.update(fbDb.collection(SENTENCES_COL).doc(item.oldRecordId), contentFields);
        updated += 1;
      } else {
        batch.set(fbDb.collection(SENTENCES_COL).doc(), data);
        added += 1;
      }
      ops += 1;
      if ((added + updated) % 50 === 0) progress.textContent = `批次寫入中 ${added + updated}/${total}…`;
      await commitIfFull();
    }
    if (ops) await batch.commit();
    await reloadSentences();
    courseMetaCache.clear();
    renderSentences();
    renderCourse();
    packRecordsCache = [];
    progress.textContent = `完成：新增 ${added} 條${updated ? `，更新 ${updated} 條` : ''}。`;
  } catch (err) {
    progress.textContent = `匯入失敗：${(err && err.message) || '未知錯誤'}。請重整後再試。`;
  }
  button.disabled = true;
}

/* Course UI wiring */
$('courseUnlockButton').addEventListener('click', unlockCourse);
$('coursePinInput').addEventListener('keydown', e => { if (e.key === 'Enter') unlockCourse(); });
$('lessonBackButton').addEventListener('click', () => { courseState.lesson = 0; renderLessonGrid(); $('courseSection').scrollIntoView({ behavior: 'smooth' }); });
$('packLoadButton').addEventListener('click', loadPackPreview);
$('packImportButton').addEventListener('click', importPackRecords);
$('importUpdateCheckbox').addEventListener('change', () => { if ($('packFileInput').files.length) loadPackPreview(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && textPlay.playing) stopTextPlay(); });
