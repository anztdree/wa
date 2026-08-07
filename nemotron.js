const config = require('./config');
const OpenAI = require('openai');
const log = require('./logger');

const client = new OpenAI({
  apiKey: config.nemotron.apiKey,
  baseURL: config.nemotron.baseUrl,
});

let callCount = 0;

var SYSTEM_PROMPT =
  'Kamu Andri, cowok Indonesia, chat WA pribadi. ' +
  'Langsung jawab, jangan keluarkan proses berpikir.';

// ============================================================
// POST-PROCESSING — Hapus thinking/reasoning leak
// ============================================================
function cleanThinking(text) {
  if (!text) return text;
  var lines = text.split('\n');
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    // Skip baris thinking — dimulai dengan huruf kecil atau tanda baca thinking
    if (/^[a-z]/.test(line) && result.length === 0) continue;
    result.push(line);
  }
  var final = result.join('\n').trim();
  return final || text;
}

async function generate(messages) {
  if (!config.nemotron.apiKey) {
    log.warn('⚡ Nemotron API key tidak tersedia');
    return null;
  }
  try {
    callCount++;
    log.nemotron('📤 Request #' + callCount + ' → NVIDIA API...');
    log.startTimer('nemotron');

    var response = await client.chat.completions.create({
      model: config.nemotron.model,
      messages: messages,
      max_tokens: 256,
      temperature: 0.75,
      top_p: 0.9,
    });

    var elapsed = log.elapsed('nemotron');
    var raw = (response.choices[0] && response.choices[0].message && response.choices[0].message.content || '').trim();
    var result = cleanThinking(raw);

    if (result !== raw) {
      log.nemotron('🧹 Thinking removed → ' + raw.length + ' → ' + result.length + ' chars');
    }

    log.nemotron('📥 Response → ' + result.length + ' chars ' + (elapsed || ''));
    return result;
  } catch (err) {
    log.elapsed('nemotron');
    log.err('⚡ Nemotron API error: ' + err.message.split('\n')[0]);
    return null;
  }
}

async function generateReply(message, context) {
  var msgs = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (context && context.length > 0) {
    for (var i = 0; i < context.length; i++) {
      var m = context[i];
      var role = m.direction === 'outbound' ? 'assistant' : 'user';
      var prefix = '';
      if (role === 'user' && m.sender_name) prefix = m.sender_name + ': ';
      msgs.push({ role: role, content: prefix + m.body });
    }
  }

  msgs.push({ role: 'user', content: message });
  return generate(msgs);
}

function getCallCount() { return callCount; }

module.exports = { generate: generate, generateReply: generateReply, getCallCount: getCallCount };
