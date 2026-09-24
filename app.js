const API_URL = 'https://script.google.com/macros/s/AKfycbw9trkW9RNCRSwWou_51Q-FP6aL7Lp8sy3zizSG83fzN1Urtd3ZiMc47RUfHDBTIMJfDw/exec';
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

function parsePaste(text) {
  const labels = ['HINDI', 'CHINESE', 'PINYIN', 'ROMAN', 'EXPLANATION', 'CATEGORY', 'TAGS', 'AI SOURCE'];
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
    pinyin: found.PINYIN || '', romanHindi: found.ROMAN || '', hindiExplanation: found.EXPLANATION || '',
    category: found.CATEGORY || 'Other', tags: found.TAGS || '',
    aiSource: found['AI SOURCE'] || 'ChatGPT / Gemini', originalPaste: text
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

function playSentenceModel(sentence, button) {
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
  const callback = `receiveTeacherAudio${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const script = document.createElement('script');
  const cleanup = () => {
    delete window[callback];
    script.remove();
    button.disabled = false;
  };

  window[callback] = data => {
    cleanup();
    if (!data || !data.success || !data.audioBase64) {
      setModelAudioStatus(button, `Teacher recording unavailable: ${(data && data.message) || 'unknown error'}`);
      return;
    }
    try {
      const binary = atob(data.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const audioUrl = URL.createObjectURL(new Blob([bytes], {type:data.mimeType || 'audio/webm'}));
      teacherAudioCache.set(sentence.recordId, audioUrl);
      playTeacherAudioUrl(audioUrl, button);
    } catch (_) {
      setModelAudioStatus(button, 'The teacher recording was received but could not be decoded.');
    }
  };
  script.onerror = () => {
    cleanup();
    setModelAudioStatus(button, 'Could not load the teacher recording. Please check the newest Apps Script deployment.');
  };
  script.src = `${API_URL}?action=audio&recordId=${encodeURIComponent(sentence.recordId)}&callback=${callback}&_=${Date.now()}`;
  document.body.appendChild(script);
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function submitTeacherAudio() {
  const pin = $('audioPinInput').value.trim();
  if (!pin) { $('audioSaveMessage').textContent = 'Enter the teacher PIN.'; return; }
  if (!pendingModelSave) { $('audioPinDialog').close(); return; }
  const {sentence, recording} = pendingModelSave;
  const button = $('confirmAudioSave');
  button.disabled = true;
  $('audioSaveMessage').textContent = 'Uploading the teacher recording…';

  try {
    const audioData = await blobToBase64(recording.blob);
    const requestId = `audio-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    const form = document.createElement('form');
    form.method = 'POST'; form.action = API_URL; form.target = 'submissionFrame'; form.hidden = true;
    const fields = {action:'saveAudio', requestId, pin, recordId:sentence.recordId, mimeType:recording.mimeType, audioData};
    Object.entries(fields).forEach(([name,value]) => {
      const field = name === 'audioData' ? document.createElement('textarea') : document.createElement('input');
      field.name = name; field.value = value; form.appendChild(field);
    });
    document.body.appendChild(form); form.submit(); form.remove();
    try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {}

    let checks = 0;
    const verify = setInterval(() => {
      checks += 1;
      const callback = `verifyAudioStatus${Date.now()}`;
      const script = document.createElement('script');
      window[callback] = data => {
        delete window[callback]; script.remove();
        if (data && data.success && data.standardAudioUrl) {
          clearInterval(verify);
          const saved = state.sentences.find(row => row.recordId === sentence.recordId);
          if (saved) saved.standardAudioUrl = data.standardAudioUrl;
          renderSentences();
          $('audioSaveMessage').textContent = 'Teacher recording saved! The model button now uses your voice.';
          button.disabled = false;
          setTimeout(() => $('audioPinDialog').close(), 1300);
        } else if (data && data.success === false) {
          clearInterval(verify);
          button.disabled = false;
          $('audioSaveMessage').textContent = `Save failed: ${data.error || 'Unknown backend error.'}`;
        } else if (checks >= 20) {
          clearInterval(verify);
          button.disabled = false;
          $('audioSaveMessage').textContent = 'No confirmation was received. Please check that the newest BankApi.gs was deployed.';
        }
      };
      script.onerror = () => { delete window[callback]; script.remove(); };
      script.src = `${API_URL}?action=uploadStatus&requestId=${encodeURIComponent(requestId)}&callback=${callback}&_=${Date.now()}`;
      document.body.appendChild(script);
    }, 1500);
  } catch (_) {
    button.disabled = false;
    $('audioSaveMessage').textContent = 'The recording could not be prepared. Please record again.';
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

function submitDeleteSentence() {
  const pin = $('deletePinInput').value.trim();
  if (!pin) { $('deleteMessage').textContent = 'Enter the teacher PIN.'; return; }
  if (!pendingDeleteSentence) { $('deleteDialog').close(); return; }

  const sentence = pendingDeleteSentence;
  const button = $('confirmDelete');
  const requestId = `delete-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  button.disabled = true;
  $('deleteMessage').textContent = 'Deleting sentence…';
  try { localStorage.setItem('csbSubmissionPin', pin); } catch (_) {}

  const form = document.createElement('form');
  form.method = 'POST'; form.action = API_URL; form.target = 'submissionFrame'; form.hidden = true;
  const fields = {action:'delete', requestId, pin, recordId:sentence.recordId};
  Object.entries(fields).forEach(([name,value]) => {
    const field = document.createElement('input');
    field.name = name; field.value = value; form.appendChild(field);
  });
  document.body.appendChild(form); form.submit(); form.remove();

  let checks = 0;
  const verify = setInterval(() => {
    checks += 1;
    const callback = `verifyDeleteStatus${Date.now()}`;
    const script = document.createElement('script');
    window[callback] = data => {
      delete window[callback]; script.remove();
      if (data && data.success && data.deletedRecordId === sentence.recordId) {
        clearInterval(verify);
        state.sentences = state.sentences.filter(row => row.recordId !== sentence.recordId);
        $('sentenceCount').textContent = state.sentences.length;
        renderSentences();
        pendingDeleteSentence = null;
        $('deleteMessage').textContent = 'Sentence deleted.';
        setTimeout(() => $('deleteDialog').close(), 650);
      } else if (data && data.success === false) {
        clearInterval(verify);
        button.disabled = false;
        $('deleteMessage').textContent = `Delete failed: ${data.error || 'Unknown backend error.'}`;
      } else if (checks >= 20) {
        clearInterval(verify);
        button.disabled = false;
        $('deleteMessage').textContent = 'No confirmation was received. Refresh before trying again.';
      }
    };
    script.onerror = () => { delete window[callback]; script.remove(); };
    script.src = `${API_URL}?action=uploadStatus&requestId=${encodeURIComponent(requestId)}&callback=${callback}&_=${Date.now()}`;
    document.body.appendChild(script);
  }, 1200);
}

function createCard(sentence, preview = false) {
  const node = $('cardTemplate').content.firstElementChild.cloneNode(true);
  node.querySelector('.category-pill').textContent = sentence.category || 'Other';
  node.querySelector('.record-id').textContent = preview ? 'PREVIEW' : sentence.recordId || '';
  const deleteButton = node.querySelector('.card-delete-button');
  deleteButton.hidden = preview;
  if (!preview) deleteButton.addEventListener('click', () => openDeleteDialog(sentence));
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

function renderSentences() {
  const visible = state.sentences.filter(s => {
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
  $('apiStatus').className = 'live-status ready'; $('apiStatus').innerHTML = '<i></i> Google Sheet connected';
  renderFilters(); renderSentences();
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

function loadBank(attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_MS = 9000;
  window.__sentenceBankLoaded = false;
  $('apiStatus').className = 'live-status';
  $('apiStatus').innerHTML = attempt > 1 ? `<i></i> Retrying… (${attempt}/${MAX_ATTEMPTS})` : '<i></i> Connecting';
  const callback = `sentenceBankCallback${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const script = document.createElement('script');
  let finished = false;
  const finish = (fn) => { if (finished) return; finished = true; clearTimeout(timer); delete window[callback]; script.remove(); fn(); };
  const timer = setTimeout(() => finish(() => handleBankFailure(attempt, MAX_ATTEMPTS, 'Google Sheets took too long to respond.')), TIMEOUT_MS);
  window[callback] = data => finish(() => {
    if (!data || !data.success) { handleBankFailure(attempt, MAX_ATTEMPTS, 'The Google Sheets API returned an error.'); return; }
    receiveBank(data);
  });
  script.onerror = () => finish(() => handleBankFailure(attempt, MAX_ATTEMPTS, 'Could not reach Google Sheets.'));
  script.src = `${API_URL}?action=list&callback=${callback}&_=${Date.now()}`;
  document.body.appendChild(script);
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
initPronunciationLab();
loadBank();
